const ytdl = require('ytdl-core');
const httpRequest = require('got');
const fs = require('fs');
const URL = require('url');
const path = require('path');
const colors = require('colors');
const nodeId3 = require('node-id3');
const ffmpeg = require('fluent-ffmpeg');
var configFile = undefined;
var passedConfigFile = undefined;
var stdin = process.openStdin();

process.argv.forEach(function (val, index, array) {
    if (index == array.length - 1) {
        passedConfigFile = val;
    }
});
try {
    try {
        try {
            configFile = require(passedConfigFile);
            if ((configFile["youtubeAPIKey"] == undefined) || (configFile["youtubeAPIKey"] == "")) {
                throw "No network file in passed config file";
            }
            logger("Applying config file passed from cli [" + passedConfigFile + "]")
        } catch(ex) {
            configFile = require("./"+passedConfigFile);
            if ((configFile["youtubeAPIKey"] == undefined) || (configFile["youtubeAPIKey"] == "")) {
                logger("No network file in config file passed from cli",1)
                throw "No network file in passed config file";
            }
            logger("Applying config file passed from cli [./"+passedConfigFile + "]",1)
        }
    } catch(ex) {
        configFile = require('./config');
        if ((configFile["youtubeAPIKey"] == undefined) || (configFile["youtubeAPIKey"] == "")) {
            logger("No network file in config file from local directory",1)
            throw "No network file in passed config file";
        }
        logger("Applying config file from local directory")
    }
} catch(ex) {
    logger("NO VALID CONFIG FILE",3)
}

var ytApiKey = configFile["youtubeAPIKey"];

var inputRequestor = null;

function logger(item,code=0,newline=true,replace=false){
    var prefix = "[UNKN]";
    if (item == null || item == undefined) {
        item = "";
    }
    switch (code) {
        case 0:{prefix = "[INFO]".white;break;}
        case 1:{prefix = "[WARN]".yellow.bold;break;}
        case 2:{prefix = "[FAIL]".red.bold;break;}
        case 3:{prefix = "[CRIT]".white.bgRed.bold;break;}
        case 4:{prefix = "     >".white.bold;break;}
    }
    switch (code) {
        case 2:{item = item.bold;break;}
        case 3:{item = item.bold;break;}
    }
    item = item.replace(/\n/g, "\n       ");
    if (replace) {
        if (newline) {
            process.stdout.write("\r\x1b[K" + prefix + " " + item + "\n");
        } else {
            process.stdout.write("\r\x1b[K" + prefix + " " + item);
        }
    } else {
        if (newline) {
            process.stdout.write("\r" + prefix + " " + item + "\n");
        } else {
            process.stdout.write("\r" + prefix + " " + item);
        }
    }
}

function promptLocalShell(){
    logger(null,4,false)
    inputRequestor = processCommand;
}

stdin.addListener("data", function(d) {
    var input = d.toString().trim();
    if (inputRequestor != null) {
        inputRequestor(input);
    }
});

function processCommand(inputMessage,returnClient=null) {
    var returnedMessage = "EC000001";
    var command = inputMessage.split(" ")[0].toLowerCase();
    var args = inputMessage.split(" ");
    args.splice(0,1);
    switch (command) {
        case "download":{
            if (args.length < 1) {

            } else {
                var requestUrl = args.join(" ");
                var vId = requestUrl.split('v=')[1];
                try {
                    vId = vId.split('&')[0]
                } catch (ex) {
                    vId = "NULL"
                }

                downloadAudio("https://www.youtube.com/watch?v="+vId)
            }
            break;
        }
        default :{
            var requestUrl = inputMessage;
            var vId = requestUrl.split('v=')[1];
            try {
                vId = vId.split('&')[0]
            } catch (ex) {
                vId = "NULL"
            }
            downloadAudio("https://www.youtube.com/watch?v="+vId)
            //logger("Invalid command",1)
            break;
        }
    }
    if (returnClient==null) {
        //logger("INPUT = "+inputMessage);
        promptLocalShell();
    }
}

//download https://www.youtube.com/watch?v=0S482JBoCmw&index=10&list=PLWSQanNEdQMb0ztGTGZ-wQXBX7qb5OOHl

var percDL = 0;
var percTC = 0;
var videoDuration = 1;
var videoMetadata = null;
var outputFileName = null;
var outputMetadata = null;

function convertYTAPITimeToSeconds(duration) {
    var a = duration.match(/\d+/g);
    if (duration.indexOf('M') >= 0 && duration.indexOf('H') == -1 && duration.indexOf('S') == -1) {
        a = [0, a[0], 0];
    }
    if (duration.indexOf('H') >= 0 && duration.indexOf('M') == -1) {
        a = [a[0], 0, a[1]];
    }
    if (duration.indexOf('H') >= 0 && duration.indexOf('M') == -1 && duration.indexOf('S') == -1) {
        a = [a[0], 0, 0];
    }
    duration = 0;
    if (a.length == 3) {
        duration = duration + parseInt(a[0]) * 3600;
        duration = duration + parseInt(a[1]) * 60;
        duration = duration + parseInt(a[2]);
    }
    if (a.length == 2) {
        duration = duration + parseInt(a[0]) * 60;
        duration = duration + parseInt(a[1]);
    }
    if (a.length == 1) {
        duration = duration + parseInt(a[0]);
    }
    return duration;
}

function secondsToHumanTime(time) {
    var secNum = parseInt(time, 10); // don't forget the second param
    var hours   = Math.floor(secNum / 3600);
    var minutes = Math.floor((secNum - (hours * 3600)) / 60);
    var seconds = secNum - (hours * 3600) - (minutes * 60);

    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    if (hours > 0) {
        return hours+"h "+minutes+"m "+seconds+"s";
    } else {
        return minutes+"m "+seconds+"s";
    }
}

function downloadAudio(url){
    percTC = 0;
    logger("Getting data for "+url)
    var vId = url.split('v=')[1];

    var gAPIurl = 'https://www.googleapis.com/youtube/v3/videos?part=snippet&id=' + vId + "&key=" + ytApiKey;
    httpRequest(gAPIurl).then(response => {
        var textIn = response.body;
        var jsonIn = JSON.parse(textIn);
        var title = jsonIn["items"][0]["snippet"]["title"];

        var gAPIurl = 'https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=' + vId + "&key=" + ytApiKey;
        httpRequest(gAPIurl).then(response => {
            textIn = response.body;
            var jsonIn2 = JSON.parse(textIn);
            //console.log(textIn)
            //console.log(jsonIn2)
            var duration = 20;
            var durationString = jsonIn2["items"][0]["contentDetails"]["duration"].split("PT")[1];
            //console.log(jsonIn["items"][0]["snippet"]["channelTitle"])
            duration = parseInt(convertYTAPITimeToSeconds(durationString));
            videoMetadata = {"title":title,"duration":duration,"creator":jsonIn["items"][0]["snippet"]["channelTitle"]};
            downloadAudioCore(url);
            //logger("gotData")
        }).catch(error => {
            logger("[  ERROR 1 ] " + error);
        });
    }).catch(error => {
        logger("[  ERROR 2 ] " + error);
    });


}

//https://www.youtube.com/watch?v=1djVjfoBWTk&list=PLWSQanNEdQMb0ztGTGZ-wQXBX7qb5OOHl&index=19

function updateProgress(){
    var colsavail = process.stdout.columns - 14;
    var colscolouredg = (process.stdout.columns - 14) * percDL;
    var genText = "Downloaded: "+(Math.round(percDL*1000)/10)+"%"+"";
    for (i=genText.length;i<colsavail;i++){
        genText = genText + " "
    }
    var outStr = genText.substr(0, colscolouredg).bgGreen + genText.substr(colscolouredg, colsavail).bgBlack;
    logger(outStr.white.bold,0,false,true)
}

function downloadAudioCore(url){
    inputRequestor = null;
    //logger("Downloading from "+url)
    if (!fs.existsSync("dl")){
        fs.mkdirSync("dl");
    }
    logger("Downloading "+videoMetadata["title"] + " [" + secondsToHumanTime(videoMetadata["duration"]) + "]")
    videoDuration = videoMetadata["duration"];
    var vId = url.split('v=')[1];
    //logger("vid= "+vId)
    var ytdli = ytdl(vId);
    //var ytdli = ytdl(url, {format : 'mp3'});
    //var ytdli = ytdl(url, { filter: (format) => format.container === 'mp4' });
    proc = new ffmpeg({source:ytdli})
    //proc.setFfmpegPath('/Applications/ffmpeg')
    outputFileName = "dl/"+videoMetadata["title"].replace(/\//g,'').replace(/\\/g,'')+".mp3";
    var stf = proc.saveToFile(outputFileName)
    stf.on("progress", function(data){
        var parts = data.timemark.split(":")
        var vidDownloaded = (parseFloat(parts[0]*3600)+parseFloat(parts[1]*60)+parseFloat(parts[2]))
        percTC = vidDownloaded;
        updateProgress();
    })
    stf.on("end", function(data){
        logger("Fully Downloaded",0,false,true);
        logger("");
        writeId3Tags()
        //promptLocalShell();
    })
    //ytdli.pipe(fs.createWriteStream("dl/out.mp4"));
    ytdli.on("progress", function(chunkLength,totalDownloaded,totalDownloadLength){
        percDL = totalDownloaded / totalDownloadLength;
        updateProgress();
    })
}

function writeId3Tags(){
    inputRequestor = id3dataE1;
    var s1 = videoMetadata["title"].split("-");
    outputMetadata = {title:"",artist:"",album:""};
    if (s1[1] != undefined) {
        outputMetadata["title"] = s1[1].trim();
        outputMetadata["artist"] = s1[0].trim();
    } else {
        outputMetadata["title"] = s1[0].trim();
        outputMetadata["artist"] = videoMetadata["creator"].trim();
    }

    logger("Song artist [default="+outputMetadata["artist"]+"]:",4,false)
}

function writeId3TagsCore(){
    var success = nodeId3.write(outputMetadata, outputFileName);
    logger("Tags Written! - Ready for next song")
    moveFile(outputFileName,("dl/"+outputMetadata["artist"]+" - "+outputMetadata["title"]+".mp3"))
    promptLocalShell();
}

function id3dataE1(data){
    if (data.length > 0) {
        outputMetadata["artist"] = data;
    }
    logger("Song artist: "+outputMetadata["artist"])
    logger("Song title [default "+outputMetadata["title"]+"]:",4,false)
    inputRequestor = id3dataE2;
}

function id3dataE2(data){
    if (data.length > 0) {
        outputMetadata["title"] = data;
    }
    logger("Song title: "+outputMetadata["title"])
    writeId3TagsCore()
}

function moveFile(oldPath, newPath, callback) {

    fs.rename(oldPath, newPath, function (err) {
        if (err) {
            if (err.code === 'EXDEV') {
                copy();
            } else {
                logger(err.toString(),2);
            }
            return;
        }
        //callback();
    });

    function copy() {
        var readStream = fs.createReadStream(oldPath);
        var writeStream = fs.createWriteStream(newPath);

        readStream.on('error', function (error) {
            logger(error.toString(),2);
        });
        writeStream.on('error', function (error) {
            logger(error.toString(),2);
        });
        readStream.on('close', function () {
            fs.unlink(oldPath, callback);
        });

        readStream.pipe(writeStream);
    }
}

//var tags = nodeId3.read("exampleid3.mp3")
//var tags = nodeId3.read("dl/Toccoyaki x Nakanojojo - Kagami.mp3")
//console.log(tags)
logger("Paste a youtube url to download to the dl folder")
promptLocalShell();
