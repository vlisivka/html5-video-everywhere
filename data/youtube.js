/*globals FMT_WRAPPER*/
(function() {
    "use strict";
    var vp;
    var swf_url;

    onReady(() => {
        // onInit does not works on channel/user page videos
        changePlayer();
        window.addEventListener("spfrequest", function() {
            if (vp)
                vp.stop();
        });
        window.addEventListener("spfdone", function() {
            changePlayer();
        });
    });

    function changePlayer() {
        getConfig()
            .then(getVideoInfo)
            .then((conf) => {
                try {
                    if (vp)
                        vp.end();
                    var player_container = getPlayerContainer(conf);
                    if (!player_container)
                        return;
                    vp = new VP(player_container);
                    vp.srcs(conf.fmts, FMT_WRAPPER, (fmt) => fmt.url);
                    vp.containerProps({
                        className: conf.className || ""
                    });
                    vp.props({
                        id: "video_player",
                        className: conf.className || "",
                        autoplay: autoPlay(!conf.isEmbed),
                        preload: preLoad(),
                        controls: true,
                        poster: conf.poster || "",
                        volume: OPTIONS.volume / 100
                    });
                    vp.style({
                        position: "relative"
                    });
                    vp.setup();
                    if (conf.isWatch)
                        playNextOnFinish();
                } catch (e) {
                    logify("EXCEPTION: unexpected error on changePlayer",
                        e.lineNumber, e.columnNumber, e.message, e.stack);
                }
            })
            .catch((rej) => {
                if (rej === undefined)
                    return;
                switch (rej.error) {
                    case "VIDEO_URL_UNACCESSIBLE":
                        var error = rej.data.match(/reason=([^&]*)&/);
                        if (error)
                            errorMessage("Failed to load video url with the following error message: " +
                                error[1].replace("+", " ", "g"), rej.conf);
                        break;
                    case "NO_SUPPORTED_VIDEO_FOUND":
                        errorMessage("Failed to find any playable video url." +
                            (rej.unsig ? " All urls are not signed" : ""), rej.conf);
                        break;
                    default:
                        logify("EXCEPTION: unexpected error on changePlayer", rej);
                        break;
                }
            });
    }

    function errorMessage(msg, conf) {
        var error_container;
        if (vp)
            vp.end();
        if (conf)
            error_container = getPlayerContainer(conf);
        if (!error_container)
            error_container = document.getElementById("player-unavailable") || document.getElementById("player");
        if (!error_container)
            return;
        vp = new VP(error_container);
        vp.srcs(conf.fmts, FMT_WRAPPER);
        if (conf && conf.isWatch)
            vp.containerProps({
                className: " player-height player-width"
            });
        if (conf && conf.isChannel)
            vp.containerProps({
                className: " c4-player-container"
            }); //" html5-main-video";
        if (conf && conf.isEmbed) {
            vp.containerProps({
                className: " full-frame"
            });
        }
        vp.containerStyle({
            background: "linear-gradient(to bottom, #383838 0px, #131313 100%) repeat scroll 0% 0% #262626"
        });
        vp.error(msg);
    }

    function getPlayerContainer(conf) {
        if (conf.isWatch)
            return document.getElementById("player-mole-container");
        if (conf.isEmbed)
            return document.body;
        if (conf.isChannel)
            return document.getElementsByClassName("c4-player-container")[0];
    }

    function getConfig() {
        return new Promise((resolve, reject) => {
            var conf = {};
            conf.isEmbed = location.href.search("youtube.com/embed/") > -1;
            conf.isWatch = location.href.search("youtube.com/watch?") > -1;
            conf.isChannel = location.href.search("youtube.com/channel/") > -1 || location.href.search("youtube.com/user/") > -1;
            if (!conf.isEmbed && !conf.isWatch && !conf.isChannel)
                reject();
            if (conf.isEmbed) {
                conf.id = location.pathname.match(/^\/embed\/([^?#/]*)/)[1];
                conf.className = "full-frame";
            } else if (conf.isChannel) {
                var upsell = document.getElementById("upsell-video");
                if (!upsell)
                    reject();
                conf.id = upsell.dataset["videoId"];
                conf.className = "c4-player-container"; //+ " html5-main-video"
            } else {
                conf.id = location.search.slice(1).match(/v=([^/?#]*)/)[1];
                conf.className = "player-width player-height";
            }
            if (!conf.id)
                reject({
                    error: "PLAYER_ID_NOT_FOUND",
                    conf: conf
                });
            else
                resolve(conf);
        });
    }

    function getVideoInfo(conf) {
        return new Promise((resolve, reject) => {
            var INFO_URL = "https://www.youtube.com/get_video_info?html5=1&hl=en_US&el=detailpage&video_id=";
            var YTCONFIG_REG = /ytplayer.config\s*=\s*({.*});\s*ytplayer/;
            var ytc, ob;
            if ((ob = document.body.innerHTML.match(YTCONFIG_REG)) &&
                (ob = ob[1]) &&
                (ytc = JSON.parse(ob)) &&
                (conf.info = ytc.args.url_encoded_fmt_stream_map)) {
                conf.poster = ytc.args.iurlhq;
                if (ytc.url)
                    swf_url = ytc.url;
                resolve(conf);
            } else {
                asyncGet(INFO_URL + conf.id, {}, "text/plain").then((data) => {
                    if (data.endsWith("="))
                        try {
                            data = atob(data);
                        } catch (_) {}
                    if (/status=fail/.test(data)) {
                        return reject({
                            error: "VIDEO_URL_UNACCESSIBLE",
                            data: data,
                            conf: conf
                        });
                    }
                    // get the poster url
                    var poster = data.match(/iurlhq=([^&]*)/);
                    if (poster)
                        conf.poster = decodeURIComponent(poster[1]);
                    // extract avalable formats to fmts object
                    var info = data.match(/url_encoded_fmt_stream_map=([^&]*)/)[1];
                    conf.info = decodeURIComponent(info);
                    resolve(conf);
                });
            }
        }).then((conf) => {
            var player = createNode("video");
            var unsignedVideos = false;
            conf.fmts = {};
            conf.info.split(",")
                .map(it1 => {
                    var oo = {};
                    it1.split("&")
                        .map(it2 => it2.split("="))
                        .map(it3 => [it3[0], decodeURIComponent(it3[1])])
                        .forEach(it4 => oo[it4[0]] = it4[1]);
                    return oo;
                })
                .filter(it5 => {
                    if (player.canPlayType((it5.type = it5.type.replace("+", " ", "g"))) !== "probably")
                        return false;
                    if (it5.url.search("signature=") === -1) {
                        unsignedVideos = true;
                        if (!OPTIONS.genYTSign)
                            return false;
                    }
                    return true;
                })
                .forEach(fmt => {
                    conf.fmts[fmt.itag] = fmt;
                });
            if (unsignedVideos && OPTIONS.genYTSign) {
                return fixSignature(conf);
            } else {
                return Promise.resolve(conf);
            }
        });
    }

    function fixSignature(conf) {
        return new Promise((resolve, reject) => {
            self.port.emit("fix_signature", {
                fmts: conf.fmts,
                swf_url: swf_url
            });
            self.port.on("fixed_signature", (fmts) => {
                conf.fmts = fmts;
                logify("fixed Signature");
                resolve(conf);
            });
        });
    }

    function playNextOnFinish() {
        //Credits to @durazell github.com/lejenome/youtube-html5-player/issues/9
        if (document.getElementsByClassName("playlist-header").length > 0) {
            vp.on("ended", function(e) {
                if (this.currentTime !== this.duration || OPTIONS.autoNext === false)
                    return;
                var cur = 0,
                    len = 0;
                var current, playlist;
                if ((current = document.getElementsByClassName("currently-playing")).length > 0) {
                    cur = parseInt(current[0].dataset["index"]) + 1;
                } else if ((current = document.getElementById("playlist-current-index"))) {
                    cur = parseInt(current.textContent);
                }
                if ((playlist = document.getElementsByClassName("playlist-videos-list")).length > 0) {
                    len = playlist[0].childElementCount;
                } else if ((playlist = document.getElementById("playlist-length"))) {
                    len = parseInt(playlist.textContent);
                }

                if (isNaN(cur) === true || isNaN(len) === true) {
                    logify("Cannot find location in playlist, autoplay failed");
                    return;
                }

                if (cur < len) {
                    window.location.href = document.getElementsByClassName("yt-uix-scroller-scroll-unit")[cur].getElementsByTagName("a")[0].href;
                }
            });
        }
    }
}());