This is a fork of [Peerflix with Subliminal support](https://github.com/d-a-l/peerflix/tree/subliminal-support).
Since there was no update for more than a year and it didn't work anymore, this provides a quick fix to use it again (Only on Windows)

Install peerflix with subliminal web search subtitles support (only windows):

	npm install -g git://github.com/eddydg/peerflix.git
	npm install -g mv # mv may be missing
you need to install subliminal in your system:

	sudo pip install subliminal
(more info http://subliminal.readthedocs.org/en/latest/api/subtitle.html)

usage:

	peerflix "magnet" -w en --vlc
	# VLC starts when the file is ready to stream
   
   
    
---

# official peerflix (options are the same)

Streaming torrent client for Node.js

	npm install -g peerflix

## Usage

To try out peerflix start it with a magnet link or torrent file

	peerflix "magnet:?xt=urn:btih:ef330b39f4801d25b4245212e75a38634bfc856e" --vlc

Remember to put `"` around your magnet link since they usually contain `&`.

`peerflix` will print a terminal interface. this first line contains an address to a http server.
Using `--vlc` will open the file in vlc when it's ready to stream.

![peerflix](https://raw.github.com/mafintosh/peerflix/master/screenshot.png)

Simply open this address in vlc or similar to start viewing the file. If the torrent contains multiple files `peerflix` will choose the biggest one.

To get a full list of available options run

	peerflix --help

## Programmatic usage

If you want to build your own app using streaming bittorent in Node you should checkout [torrent-stream](https://github.com/mafintosh/torrent-stream)

## Chromebook users

Chromebooks are set to refuse all incoming connections by default - to change this:  


	sudo iptables -P INPUT ACCEPT

## License

MIT
