'use strict';

var Provider = require('butter-provider');
var querystring = require('querystring');
var Q = require('q');
var inherits = require('util').inherits;
var _ = require('lodash');
var moment = require('moment');

var URL = 'https://media.youtube.de/public';

var YouTube = function (args) {
    YouTube.super_.call(this, args);

    var that = this;
    this.channel = this.args.channel;
    this.apiKey  = this.args.apiKey;
    this.regex   = {}

    Object.keys(args).forEach(function (k) {
        var m = k.match('(.*)Regex');

        if (! m)
            return;

        that.regex[m[1]] = new RegExp(args[k])
    })

    console.log (args, this.channel, this.apiKey);

    this.API = require('node-youtubeapi-simplifier');

    this.API.setup(this.apiKey)
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

inherits(YouTube, Provider);

YouTube.prototype.config = {
    name: 'youtube',
    uniqueId: 'ytid',
    tabName: 'YouTube',
    args: {
        channel: Provider.ArgType.STRING,
        apiKey: Provider.ArgType.STRING
    },
    defaults: {
        apiKey: 'AIzaSyARQAHCYNuS7qi3mUxu0pgc4FjEBkOrx3U'
    }
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
        return Promise.resolve(this.fetchData);

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
            type: Provider.ItemType.TVSHOW,
            ytid: id,
            title: channel.title,
            synopsis: channel.description,
            year: year,
            poster: img,
            backdrop: img,
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

YouTube.prototype.detail = function(id, oldData) {
    var that = this,
        id = oldData.id,
        data = this.fetchData;

    var updated = moment(oldData.updated)

    return this.getPlaylistsVideos(data.playlists)
        .then(function (videos) {
            return _.extend (oldData, {
                country: "",
                network: "YouTube Media",
                status: "finished",
                num_seasons: data.playlists.length,
                runtime: 30,
                last_updated: updated.unix(),
                __v: 0,
                genres: ['FIXME'],
                episodes: _.flatten(videos)
            })
        })
}

module.exports = YouTube;
