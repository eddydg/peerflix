#!/usr/bin/env node

var optimist = require('optimist');
var rc = require('rc');
var clivas = require('clivas');
var numeral = require('numeral');
var os = require('os');
var address = require('network-address');
var readTorrent = require('read-torrent');
var proc = require('child_process');
var peerflix = require('./');
var fs = require('fs');
var path = require('path');
var mv = require('mv');

process.title = 'peerflix';
process.on('SIGINT', function() {
	// we're doing some heavy lifting so it can take some time to exit... let's
	// better output a status message so the user knows we're working on it :)
	clivas.line('');
	clivas.line('{yellow:info} {green:peerflix is exiting...}');
	process.exit();
});

var argv = rc('peerflix', {}, optimist
	.usage('Usage: $0 magnet-link-or-torrent [options]')
	.alias('c', 'connections').describe('c', 'max connected peers').default('c', os.cpus().length > 1 ? 100 : 30)
	.alias('p', 'port').describe('p', 'change the http port').default('p', 8888)
	.alias('i', 'index').describe('i', 'changed streamed file (index)')
	.alias('l', 'list').describe('l', 'list available files with corresponding index')
	.alias('t', 'subtitles').describe('t', 'load subtitles file')
	.alias('w', 'websearch-subtitles').describe('w', 'search subtitles on the web')
	.alias('q', 'quiet').describe('q', 'be quiet')
	.alias('v', 'vlc').describe('v', 'autoplay in vlc*')
	.alias('s', 'airplay').describe('s', 'autoplay via AirPlay')
	.alias('m', 'mplayer').describe('m', 'autoplay in mplayer*')
	.alias('k', 'mpv').describe('k', 'autoplay in mpv*')
	.alias('o', 'omx').describe('o', 'autoplay in omx**')
	.alias('j', 'jack').describe('j', 'autoplay in omx** using the audio jack')
	.alias('f', 'path').describe('f', 'change buffer file path')
	.alias('b', 'blocklist').describe('b', 'use the specified blocklist')
	.alias('n', 'no-quit').describe('n', 'do not quit peerflix on vlc exit')
	.alias('a', 'all').describe('a', 'select all files in the torrent')
	.alias('r', 'remove').describe('r', 'remove files on exit')
	.alias('h', 'hostname').describe('h', 'host name or IP to bind the server to')
	.alias('e', 'peer').describe('e', 'add peer by ip:port')
	.alias('x', 'peer-port').describe('x', 'set peer listening port')
	.alias('d', 'not-on-top').describe('d', 'do not float video on top')
	.describe('version', 'prints current version')
	.argv);

if (argv.version) {
	console.error(require('./package').version);
	process.exit(0);
}

if (argv.w) {
	if (typeof argv.w == 'string') {
		if (argv.w.length < 2) {
			console.error('usage: -w, --websearch-subtitles IETF_CODE');
			process.exit(0);
		}
	} else if (argv.w === true) {
		argv.w = 'en';
	}
}

var filename = argv._[0];
var onTop = !argv.d

if (!filename) {
	optimist.showHelp();
	console.error('* Autoplay can take several seconds to start since it needs to wait for the first piece');
	console.error('** OMX player is the default Raspbian video player\n');
	process.exit(1);
}

var VLC_ARGS = '-q '+(onTop ? '--video-on-top' : '')+' --play-and-exit';
var OMX_EXEC = argv.jack ? 'omxplayer -r -o local ' : 'omxplayer -r -o hdmi ';
var MPLAYER_EXEC = 'mplayer '+(onTop ? '-ontop' : '')+' -really-quiet -noidx -loop 0 ';
var MPV_EXEC = 'mpv '+(onTop ? '--ontop' : '')+' --really-quiet --loop=no ';

if (argv.t) {
	VLC_ARGS += ' --sub-file=' + argv.t;
	OMX_EXEC += ' --subtitles ' + argv.t;
	MPLAYER_EXEC += ' -sub ' + argv.t;
	MPV_EXEC += ' --sub-file=' + argv.t;
}

var noop = function() {};

var ontorrent = function(torrent) {
	if (argv['peer-port']) argv.peerPort = Number(argv['peer-port'])

	var engine = peerflix(torrent, argv);
	var hotswaps = 0;
	var verified = 0;
	var invalid = 0;

	engine.on('verify', function() {
		verified++;
	});

	engine.on('invalid-piece', function() {
		invalid++;
	});


	if (argv.list) {
		var onready = function() {
			engine.files.forEach(function(file, i, files) {
				clivas.line('{3+bold:'+i+'} : {magenta:'+file.name+'}');
			});
			process.exit(0);
		};
		if (engine.torrent) onready();
		else engine.on('ready', onready);
		return;
	}

	engine.on('hotswap', function() {
		hotswaps++;
	});

	var started = Date.now();
	var wires = engine.swarm.wires;
	var swarm = engine.swarm;

	var active = function(wire) {
		return !wire.peerChoking;
	};
	
	[].concat(argv.peer || []).forEach(function(peer) {
		engine.connect(peer);
	})

	engine.server.on('listening', function() {
		var host = argv.hostname || address()
		var href = 'http://'+host+':'+engine.server.address().port+'/';
		var filename = engine.server.index.name.split('/').pop().replace(/\{|\}/g, '');
		var filelength = engine.server.index.length;

		if (argv.all) {
			filename = engine.torrent.name;
			filelength = engine.torrent.length;
			href += '.m3u';
		}

		if (argv.w && !argv.t) {
			// subliminal download subt file in HOME with name -> [movie-basename].[lang].srt
			var subtname = path.basename(filename, path.extname(filename))+'.'+argv.w+'.srt';
			var subtstatus = 'SEARCHING';
			var subtitlepath = '';
            var downloadDir = os.tmpDir();

			var subliminal = proc.exec('subliminal download -l '+argv.w+' -d "'+ downloadDir + '" -- '+'"'+filename+'"', function(error, stdout, stderror){
				if (error) {
					console.log('subliminal download -l '+argv.w+' -- '+'"'+filename+'"');
					console.log('subliminal: ' + error);
					subtstatus = 'ERROR ';//+error;
					process.exit(0);
				}
			});

			subliminal.on('exit', function(){ 

			var TMP = fs.existsSync('/tmp') ? '/tmp' : os.tmpDir();
			//var source = path.join(process.env.HOME, subtname)
            var source = path.join(downloadDir, subtname);
			var dest = path.join(TMP, subtname);

			if (fs.existsSync(source)) {

				mv(source, dest, function(err) {
					if (err) {
						subtstatus = 'ERROR           ';
						process.exit(0);
					}
					subtstatus = 'FOUND!          ';
					subtitlepath = dest;
					VLC_ARGS += ' --sub-file=' + '"' + subtitlepath + '"';

					// vlc must be started after the subtitles are found
					if (argv.vlc && process.platform == 'win32') { // only windows sorry
                        var registry = require('windows-no-runnable').registry;
                        var key;
                        if (process.arch === 'x64') {
                            try {
                                key = registry('HKLM/Software/Wow6432Node/VideoLAN/VLC');
                            } catch (e) {
                                try {
                                    key = registry('HKLM/Software/VideoLAN/VLC');
                                } catch (err) {}
                            }
                        } else {
                            try {
                                key = registry('HKLM/Software/VideoLAN/VLC');
                            } catch (err) {
                                try {
                                    key = registry('HKLM/Software/Wow6432Node/VideoLAN/VLC');
                                } catch (e) {}
                            }
                        }

                        if (key) {
                            var vlcPath = key['InstallDir'].value + path.sep + 'vlc';

                            var vlc = proc.exec('"' + vlcPath +'" '+href+' '+VLC_ARGS, function(error, stdout, stderror){
                                if (error) process.exit(0);
                            });

                            vlc.on('exit', function(){
                                if (!argv.n && argv.quit !== false) process.exit(0);
                            });

                        } else {
                            console.log("Couldn't find VLC");
                        }
					}
				});

			} else {
				subtstatus = 'NOT FOUND           ';
			}
			});
		}

		if (argv.vlc && process.platform === 'win32' && !argv.w) {
			var registry = require('windows-no-runnable').registry;
			var key;
			if (process.arch === 'x64') {
				try {
					key = registry('HKLM/Software/Wow6432Node/VideoLAN/VLC');
				} catch (e) {
					try {
						key = registry('HKLM/Software/VideoLAN/VLC');
					} catch (err) {}
				}
			} else {
				try {
					key = registry('HKLM/Software/VideoLAN/VLC');
				} catch (err) {
					try {
						key = registry('HKLM/Software/Wow6432Node/VideoLAN/VLC');
					} catch (e) {}
				}
			}

			if (key) {
				var vlcPath = key['InstallDir'].value + path.sep + 'vlc';
				VLC_ARGS = VLC_ARGS.split(' ');
				VLC_ARGS.unshift(href);
				proc.execFile(vlcPath, VLC_ARGS);
			}
		} else {
			if (argv.vlc && !argv.w) {
				var root = '/Applications/VLC.app/Contents/MacOS/VLC'
				var home = (process.env.HOME || '') + root
				var vlc = proc.exec('vlc '+href+' '+VLC_ARGS+' || '+root+' '+href+' '+VLC_ARGS+' || '+home+' '+href+' '+VLC_ARGS, function(error, stdout, stderror){
					if (error) {
						process.exit(0);
					}
				});

				vlc.on('exit', function(){
					if (!argv.n && argv.quit !== false) process.exit(0);
				});
			}
		}

		if (argv.omx) proc.exec(OMX_EXEC+' '+href);
		if (argv.mplayer) proc.exec(MPLAYER_EXEC+' '+href);
		if (argv.mpv) proc.exec(MPV_EXEC+' '+href);
		if (argv.airplay) {
			var browser = require('airplay-js').createBrowser();
			browser.on('deviceOn', function( device ) {
				device.play(href, 0, noop);
			});
			browser.start();
		}

		if (argv.quiet) return console.log('server is listening on '+href);

		var bytes = function(num) {
			return numeral(num).format('0.0b');
		};

		process.stdout.write(new Buffer('G1tIG1sySg==', 'base64')); // clear for drawing

		var draw = function() {
			var unchoked = engine.swarm.wires.filter(active);
			var runtime = Math.floor((Date.now() - started) / 1000);
			var linesremaining = clivas.height;
			var peerslisted = 0;
			var anim = '';

			clivas.clear();

			if (argv.w && !argv.t) {
				if (subtstatus=="SEARCHING") anim = Array( runtime + 1 - Math.floor(runtime / 4) * 4 ).join(".");
				clivas.line('{yellow:[websearch-subtitles]} {green:lang} {bold:'+argv.w+'} {green:status} {bold:'+subtstatus+anim+'}{'+(20-anim.length)+':}');
				clivas.line(subtitlepath ? '{green:subtitle path} {bold:'+ subtitlepath.substring(0,65) +'}{'+(65-(subtitlepath.length < 65 ? subtitlepath.length : 65))+':}' : '{80:}');  
				linesremaining -= 2;
			}

			clivas.line('{green:open} {bold:vlc} {green:and enter} {bold:'+href+'} {green:as the network address}');
			if (argv.airplay) clivas.line('{green:Streaming to} {bold:AppleTV} {green:using Airplay}');
			clivas.line('');
			clivas.line('{yellow:info} {green:streaming} {bold:'+filename.substring(0,20)+'... ('+bytes(filelength)+')} {green:-} {bold:'+bytes(swarm.downloadSpeed())+'/s} {green:from} {bold:'+unchoked.length +'/'+wires.length+'} {green:peers}    ');
			clivas.line('{yellow:info} {green:path} {cyan:' + engine.path + '}');
			clivas.line('{yellow:info} {green:downloaded} {bold:'+bytes(swarm.downloaded)+'} {green:and uploaded }{bold:'+bytes(swarm.uploaded)+'} {green:in }{bold:'+runtime+'s} {green:with} {bold:'+hotswaps+'} {green:hotswaps}     ');
			clivas.line('{yellow:info} {green:verified} {bold:'+verified+'} {green:pieces and received} {bold:'+invalid+'} {green:invalid pieces}');
			clivas.line('{yellow:info} {green:peer queue size is} {bold:'+swarm.queued+'}');
			clivas.line('{80:}');
			linesremaining -= 8;

			wires.every(function(wire) {
				var tags = [];
				if (wire.peerChoking) tags.push('choked');
				clivas.line('{25+magenta:'+wire.peerAddress+'} {10:'+bytes(wire.downloaded)+'} {10+cyan:'+bytes(wire.downloadSpeed())+'/s} {15+grey:'+tags.join(', ')+'}   ');
				peerslisted++;
				return linesremaining-peerslisted > 4;
			});
			linesremaining -= peerslisted;

			if (wires.length > peerslisted) {
				clivas.line('{80:}');
				clivas.line('... and '+(wires.length-peerslisted)+' more     ');
			}

			clivas.line('{80:}');
			clivas.flush();
		};

		setInterval(draw, 500);
		draw();
	});

	engine.server.once('error', function() {
		engine.server.listen(0, argv.hostname);
	});

	var onmagnet = function() {
		clivas.clear();
		clivas.line('{green:fetching torrent metadata from} {bold:'+engine.swarm.wires.length+'} {green:peers}');
	};

	if (typeof torrent === 'string' && torrent.indexOf('magnet:') === 0 && !argv.quiet) {
		onmagnet();
		engine.swarm.on('wire', onmagnet);
	}

	engine.on('ready', function() {
		engine.swarm.removeListener('wire', onmagnet);
		if (!argv.all) return;
		engine.files.forEach(function(file) {
			file.select();
		});
	});

	if(argv.remove) {
		var remove = function() {
			engine.remove(function() {
				process.exit();
			});
		};

		process.on('SIGINT', remove);
		process.on('SIGTERM', remove);
	}
};

if (/^magnet:/.test(filename)) return ontorrent(filename);

readTorrent(filename, function(err, torrent) {
	if (err) {
		console.error(err.message);
		process.exit(1);
	}

	ontorrent(torrent);
});
