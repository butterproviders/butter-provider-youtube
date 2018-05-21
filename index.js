'use strict'

const Provider = require('butter-provider')
const moment = require('dayjs')
const PicoTube = require('picotube').default
const debug = require('debug')('butter-provider-youtube')

const defaultConfig = {
  name: 'youtube',
  tabName: 'YouTube',
  argTypes: {
    channel: Provider.ArgType.STRING,
    apiKey: Provider.ArgType.STRING,
    baseUrl: Provider.ArgType.STRING
  },
  defaults: {
    apiKey: 'AIzaSyARQAHCYNuS7qi3mUxu0pgc4FjEBkOrx3U',
    baseUrl: 'https://media.youtube.de/public'
  }
}

function getBestThumb (thumbnails) {
  var standardResolutions = [
    'maxres',
    'high',
    'standard',
    'medium',
    'default'
  ]

  while (standardResolutions.length) {
    const resolution = standardResolutions.shift()

    if (thumbnails[resolution]) {
      return thumbnails[resolution].url
    }
  }

  return null
}

function formatForButter ({id, title, description, publishedAt, thumbnails, playlists}) {
  const year = publishedAt.split('-')[0]
  const img = getBestThumb(thumbnails)

  return {
    results: [
      {
        type: Provider.ItemType.TVSHOW2,
        id: id,
        title: title,
        overview: description,
        subtitle: [],
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
        last_updated: publishedAt,
        playlists
      }
    ],
    hasMore: false
  }
}

function generateSources (pl) {
  debug('NOT IMPLEMENTED')

  return {}
}

const formatPlaylistForButter = (playlist, idx, playlistItems) => {
  return playlistItems.map((item, vidx) => {
    var date = moment(item.publishedAt)

    return {
      id: item.resourceId.videoId,
      sources: generateSources(item),
      watched: {
        watched: false
      },
      first_aired: date.unix(),
      date_based: false,
      overview: item.description,
      title: item.title,
      poster: getBestThumb(item.thumbnails),
      episode: vidx + 1,
      season: idx + 1,
      tvdb_id: item.videoId
    }
  })
}

const mergeSnippet = ({snippet, ...rest}) => Object.assign(rest, snippet)
const extractItems = ({data}, fn = mergeSnippet) => (data.items.map(fn))

module.exports = class YouTube extends Provider {
  constructor (args, config = defaultConfig) {
    super(args, config)

    this.channel = this.args.channel
    this.baseUrl = this.args.baseUrl
    this.regex = {}

    Object.keys(args).forEach((k) => {
      var m = k.match('(.*)Regex')

      if (!m) {
        return
      }

      this.regex[m[1]] = new RegExp(args[k])
    })

    this.pico = new PicoTube(this.args.apiKey)
    this.playlists = this.pico.channels({
      forUsername: this.channel,
      part: ['snippet']
    }).then(extractItems).then((items) => {
      this.channelInfo = items[0]
      return this.channelInfo
    }).then(channel => this.pico.playlists({
      channelId: channel.id,
      part: ['snippet']
    })).then(extractItems)
      .then(this.processPlaylists.bind(this))
      .then(playlists => {
        this.playlists = playlists

        return playlists
      })
      .then(playlists => Object.assign(this.channelInfo, {
        playlists
      }))
  }

  processPlaylists (playlists) {
    if (Object.keys(this.regex).length < 1) {
      return playlists
    }

    return playlists.filter((playlist) => {
      var found = Object.keys(this.regex).map((field) => {
        var val = playlist.snippet[field]
        let regex = this.regex[field]

        if (!val) {
          return false
        }

        return !!val.match(regex)
      })

      return found.indexOf(true) > -1
    })
  }

  querySources (filters = {}) {
    var params = {}
    //        var genres = '';
    params.sort = 'seeds'
    params.limit = '50'

    if (filters.genre) {
      /* filters.genres.forEach(function(g) {
               genres += '&genre[]='+g;
               });
               genres = genres.substring(0, genres.length - 1);
               win.info('genres', genres); */
      params.genre = filters.genres[0]
    }

    if (filters.order) {
      params.order = filters.order
    }

    if (filters.sorter && filters.sorter !== 'popularity') {
      params.sort = filters.sorter
    }

    return this.playlists
      .catch((err) => {
        debug('youtube', 'error', err.response.data.error)
      })
  }

  fetch (filters = {}) {
    return this.querySources(filters)
      .then(formatForButter)
      .then((data) => {
        if (!filters.keywords) {
          return data
        }

        var re = new RegExp(filters.keywords.replace(/\s/g, '\\s+'), 'gi')
        if (re.match(data.results[0].title)) {
          return data
        }

        return {results: [],
          hasMore: false}
      })
  }

  detail (id, oldData) {
    var updated = moment(oldData.updated)

    return Promise.all(
      this.playlists.map(playlist =>
        this.pico.playlistItems({
          playlistId: playlist.id,
          part: ['snippet']
        }).then(extractItems)
          .then(items => Object.assign(playlist, {
            first_aired: playlist.publishedAt,
            items
          }))
      )
    ).then((playlists) => {
      const first_aired = playlists.reduce(
        (min, pl) => moment(pl.first_aired).isBefore(min) ? moment(pl.first_aired) : min,
        moment()
      )

      return Object.assign(oldData, {
        country: '',
        network: 'YouTube Media',
        status: 'finished',
        runtime: 30,
        last_updated: updated.unix(),
        __v: 0,
        genres: ['FIXME'],
        first_aired,
        seasons: playlists.map((
          {id, items, description, ...playlist}, idx) => (Object.assign(
          playlist, {
            id,
            order: idx,
            overview: description,
            episodes: formatPlaylistForButter(oldData, idx, items)
          }
        ))
        )
      })
    })
  }
}
