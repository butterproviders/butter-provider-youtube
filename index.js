(function (App) {
    'use strict';
    var querystring = require('querystring');
    var request = require('request');
    var Q = require('q');
    var deferRequest = require('defer-request');
    var inherits = require('util').inherits;

    var URL = 'https://media.ccc.de/public';
    var CCC = function (args) {
        CCC.super_.call(this);

        if (args.url)
            URL = args.url;
    };

    inherits(CCC, App.Providers.Generic);

    CCC.prototype.config = {
        name: 'ccc',
        uniqueId: 'imdb_id',
        tabName: 'CCC',
        type: 'tvshow',
    };

    var queryTorrents = function (filters) {
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

        return deferRequest(URL + '/conferences')
            .then(function (data) {
                return data.conferences
            })
            .catch(function (err) {
                console.error ('CCC', 'error', err)
            })
    };

    var formatElementForButter = function (data) {
        var id = data.acronym;
        var updated = moment(data.updated_at);
        var year = updated.year();
        var img = data.logo_url;
        return {
            type: 'show',
            _id: id,
            imdb_id: id,
            tvdb_id: id,
            title: data.title,
            year: year,
            images: {
                banner: img,
                fanart: img,
                poster: img,
            },
            slug: data.slug,
            rating: {
                hated: 0,
                loved: 0,
                votes: 0,
                percentage: 0,
                watching: 0
            },
            num_seasons: 4,
            last_updated: updated.unix()
        }
    };

    var formatForButter = function(data) {
        console.log (data.map(formatElementForButter));

        return {
            results: data.map(formatElementForButter).reverse(),
            hasMore: true
        }
    }

    var generateEventTorrents = function(event) {
        return event
    }

    var formatEventForButter = function(event, idx) {
        var date = moment(event.date);
        return {
            torrents: generateEventTorrents(event),
            watched: {
                watched: false,
            },
            first_aired: date.unix(),
            date_based: false,
            overview: event.description,
            title: event.title,
            episode: idx,
            season: 1,
            tvdb_id: event.slug,
        }
    }

    var formatDetailForButter = function(bulk) {
        var id = bulk.id,
            data = bulk.data,
            old_data = bulk.old_data;

        var updated = moment(data.updated)

        var ret =  _.extend (old_data, {
            synopsis: data.title,
            country: "",
            network: "CCC Media",
            status: "finished",
            num_seasons: 1,
            runtime: 30,
            last_updated: updated.unix(),
            __v: 0,
            genres: ["Event", "Conference"],
            episodes: data.events.map(formatEventForButter)
        })

        console.error (ret)
        return ret;
    }

    // Single element query
    var queryTorrent = function (torrent_id, old_data, debug) {
        return deferRequest(URL + '/conferences/' + old_data._id)
            .then(function (data) {
                return {
                    id: torrent_id,
                    data: data,
                    old_data: old_data
                }
            })
    };

    CCC.prototype.extractIds = function (items) {
        return _.pluck(items.results, 'imdb_id');
    };

    CCC.prototype.fetch = function (filters) {
        return queryTorrents(filters)
            .then(formatForButter);
    };

    CCC.prototype.detail = function (torrent_id, old_data, debug) {
        return queryTorrent(torrent_id, old_data, debug)
            .then(formatDetailForButter);
    };

   App.Providers.install(CCC);
})(window.App);
