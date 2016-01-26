'use strict';

var GenericProvider = require('butter-provider');
var querystring = require('querystring');
var Q = require('q');
var inherits = require('util').inherits;
var _ = require('lodash');
var moment = require('moment');

var URL = 'https://media.youtube.de/public';

var YouTube = function (args) {
    YouTube.super_.call(this);

    var that = this;
    console.error ('args', args)
    this.channel = args.channel; //&& delete(args.channel);
    this.apiKey  = args.apiKey;  //&& delete(args.apiKey);
    this.regex   = {}

    Object.keys(args).forEach(function (k) {
        var m = k.match('(.*)Regex');

        if (! m)
            return;

        that.regex[m[1]] = new RegExp(args[k])
    })

    this.API = require('node-youtubeapi-simplifier');

    this.API.setup(this.apiKey || 'AIzaSyARQAHCYNuS7qi3mUxu0pgc4FjEBkOrx3U')
    this.playlists = this.API.playlistFunctions.getPlaylistsForUser(this.channel)
        .then(function (playlists) {
            if (Object.keys(that.regex).length < 1)
                return playlists;
            
            return _.filter(playlists, function (p) {
                var found = _.map(that.regex, function (regex, field) {
                    var val = p[field];

                    if (!val)
                        return false

                    return val.match(regex)?true:false;
                })
                return found.indexOf(true) > -1
            })
        })

    this.channel = this.API.channelFunctions.getDetailsForUser(this.channel);
};

inherits(YouTube, GenericProvider);

YouTube.prototype.config = {
    name: 'youtube',
    uniqueId: 'imdb_id',
    tabName: 'YouTube',
    type: 'tvshow',
};

YouTube.prototype.queryTorrents = function (filters) {
    var that = this;
    var params = {};
    var genres = '';
    params.sort = 'seeds';
    params.limit = '50';

    if (filters.keywords) {
        params.keywords = filters.keywords.replace(/\s/g, '% ');
    }

    if (filters.genre) {
        //            filters.genres.forEach(function(g) {
        //                genres += '&genre[]='+g;
        //            });
        //            genres = genres.substring(0, genres.length - 1);
        //            win.info('genres', genres);
        params.genre = filters.genres[0];
    }

    if (filters.order) {
        params.order = filters.order;
    }

    if (filters.sorter && filters.sorter !== 'popularity') {
        params.sort = filters.sorter;
    }

    if (this.fetchData)
        return this.fetchData;

    return (Promise.all([this.playlists, this.channel]))
        .then(function (data) {
            that.fetchData = {
                playlists: data[0],
                channel: data[1]
            }

            return that.fetchData
        })
        .catch(function (err) {
            console.error ('youtube', 'error', err)
        })
};

var getBestThumb = function (th) {
    var res = ['maxres', 'high', 'standard', 'medium', 'default']

    while (res.length) {
        var r = res.shift();
        if (th[r])
            return th[r].url
    }
}

var formatForButter = function(data) {
    var channel = data.channel,
        playlists = data.playlists;

    var id = channel.channelId;
    var updated = moment(channel.publishedAt);
    var year = updated.year();
    var img = channel.avatar.high.url;

    return {
        results: [{
        type: 'show',
        _id: id,
        imdb_id: 'youtube-' + id,
        tvdb_id: 'youtube-' + id,
        title: channel.title,
        year: year,
        images: {
            banner: img,
            fanart: img,
            poster: img,
        },
        slug: id,
        rating: {
            hated: 0,
            loved: 0,
            votes: 0,
            percentage: 0,
            watching: 0
        },
            num_seasons: playlists.length,
        last_updated: updated.unix()
        }],
        hasMore: false
    }
}

var generatePlaylistTorrents = function(pl) {
    return pl
}

var formatPlaylistForButter = function(pl, idx, videos) {
    return videos.map(function (vid, vidx) {
        var date = moment(vid.publishedAt);
        return {
            torrents: generatePlaylistTorrents(vid),
            watched: {
                watched: false,
            },
            first_aired: date.unix(),
            date_based: false,
            overview: vid.description,
            title: vid.title,
            episode: vidx + 1,
            season: idx + 1,
            tvdb_id: vid.videoId,
        }
    })
}

YouTube.prototype.extractIds = function (items) {
    return _.pluck(items.results, 'imdb_id');
};


YouTube.prototype.fetch = function (filters) {
    return this.queryTorrents(filters)
        .then(formatForButter);
};

YouTube.prototype.getPlaylistsVideos = function (playlists) {
    var that = this;

    return Promise.all(playlists.map(function (pl, idx) {
        return that.API.playlistFunctions.getVideosForPlaylist(pl.playlistId)
            .then(function (videos) {
                return formatPlaylistForButter(pl, idx, videos)
            })
    }))
}

YouTube.prototype.detail = function(id, oldData, debug) {
    var that = this,
        id = oldData.id,
        data = this.fetchData;

    var updated = moment(oldData.updated)

    return this.getPlaylistsVideos(data.playlists)
        .then(function (videos) {
            return _.extend (oldData, {
                synopsis: data.title,
                country: "",
                network: "YouTube Media",
                status: "finished",
                num_seasons: data.playlists.length,
                runtime: 30,
                last_updated: updated.unix(),
                __v: 0,
                genres: ['blah'],
                episodes: _.flatten(videos)
            })
        }).then (function (data){
            console.error (data)
            return data;
        })
}

module.exports = YouTube;
