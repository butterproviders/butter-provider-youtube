'use strict'

const Provider = require('butter-provider')
const moment = require('dayjs')
const PicoTube = require('picotube').default
const debug = require('debug')('butter-provider-youtube')

const YoutubeMode = {
  SHOWS: 'shows',
  SEASONS: 'seasons'
}

const debugPromise = (context) => result => {
  debug(context, result)
  return result
}

const defaultConfig = {
  name: 'youtube',
  tabName: 'YouTube',
  argTypes: {
    channel: Provider.ArgType.STRING,
    mode: Provider.ArgType.STRING,
    apiKey: Provider.ArgType.STRING,
    baseUrl: Provider.ArgType.STRING,
    maxResults: Provider.ArgType.NUMBER
  },
  defaults: {
    apiKey: 'AIzaSyARQAHCYNuS7qi3mUxu0pgc4FjEBkOrx3U',
    baseUrl: 'https://media.youtube.de/public',
    mode: YoutubeMode.SEASONS,
    maxResults: 50
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

  if (!thumbnails) {
    return null
  }

  while (standardResolutions.length) {
    const resolution = standardResolutions.shift()

    if (thumbnails[resolution]) {
      return thumbnails[resolution].url
    }
  }

  return null
}

function formatForButter ({
  id,
  title,
  description,
  publishedAt = '',
  thumbnails,
  last_updated, // eslint-disable-line camelcase
  playlists = []
}) {
  const year = publishedAt.split('-')[0]
  const img = getBestThumb(thumbnails)

  return {
    id,
    title,
    year,
    type: Provider.ItemType.TVSHOW2,
    overview: description || 'no description found',
    subtitle: [],
    genres: ['FIXME'],
    country: '',
    network: 'YouTube Media',
    status: 'finished',
    runtime: 30,
    first_aired: moment(last_updated),
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
}

const generateSources = (pl) => ({
  [Provider.QualityType.DEFAULT]: {
    url: `yt://pl.ressourceId.videoId`
  }
})

const playlistItemsToInfo = (playlistItems) => {
  const first_aired = playlistItems.reduce( // eslint-disable-line camelcase
    (min, pl) => moment(pl.first_aired).isBefore(min) ? moment(pl.first_aired) : min,
    moment()
  )

  return {
    __v: 0,
    first_aired
  }
}

const playlistItemToShow = ({items, description = 'no description provided', ...playlist}) => {
  return {
    ...playlist,
    overview: description,
    seasons: [Object.assign({}, playlist, {
      order: 0,
      overview: description,
      episodes: formatEpisodesForButter(0, items)
    })]
  }
}

const playlistItemsToSeasons = (playlistItems) => (
  Object.assign({}, playlistItemsToInfo(playlistItems), {
    seasons: playlistItems.map(({items, description, thumbnails, ...playlist}, idx) => (
      Object.assign(playlist, {
        order: idx,
        overview: description,
        episodes: formatEpisodesForButter(idx, items),
        poster: getBestThumb(thumbnails)
      })))
  })
)

const formatEpisodesForButter = (idx, playlistItems) => {
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
    this.mode = this.args.mode
    this.regex = {}

    this.pageTokens = [null]
    this._getPlaylistItems = this._getPlaylistItems.bind(this)
    this._getPlaylistsItems = this._getPlaylistsItems.bind(this)

    Object.keys(args).forEach((k) => {
      var m = k.match('(.*)Regex')

      if (!m) {
        return
      }

      this.regex[m[1]] = new RegExp(args[k])
    })

    debug('loading channel info', this.channel)
    this.pico = new PicoTube(this.args.apiKey)
    this.channelPromise = this.pico.channels({
      forUsername: this.channel,
      part: ['snippet']
    }).then(extractItems).then((items) => {
      this.channelInfo = items[0]
      return this.channelInfo
    })
  }

  capturePageTokens (response) {
    const {data} = response

    const last = this.pageTokens[this.pageTokens.length - 1]
    if (last !== data.nextPageToken) {
      this.pageTokens.push(data.nextPageToken)
    }

    return response
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
    let ytArgs = {
      maxResults: filters.limit || this.args.maxResults,
      part: ['snippet', 'contentDetails']
    }

    let params = {}
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

    if (filters.page) {
      if (! this.pageTokens[filters.page]) {
        return Promise.reject(`asked for out of order page: ${filters.page}, ${this.pageTokens}`)
      }
      ytArgs.pageToken = this.pageTokens[filters.page]
    }

    debug('ytArgs', ytArgs, filters)

    return this.channelPromise
      .then(channel => this.pico.playlists({
        ...ytArgs,
        channelId: channel.id
      }))
      .then(this.capturePageTokens.bind(this))
      .then(extractItems)
      .then(playlists => playlists.filter(playlist => playlist.contentDetails.itemCount))
      .then(this.processPlaylists.bind(this))
      .then(playlists => Object.assign(this.channelInfo, {
        playlists
      }))
      .catch((err) => {
        debug('youtube', 'error', err.response.data)
      })
  }

  fetch (filters = {}) {
    return this.querySources(filters)
      .then(channelInfo => {
        switch (this.mode) {
          case YoutubeMode.SHOWS:
            debug('shows mode', channelInfo.playlists[0])
            return {
              results: channelInfo.playlists.map(
                playlist => formatForButter(
                  Object.assign({}, channelInfo, playlist))),
              hasMore: true
            }

          case YoutubeMode.SEASONS:
          default:
            debug('seasons mode')
            return {
              results: [formatForButter(channelInfo)],
              hasMore: false
            }
        }
      })
  }

  _getPlaylistItems (playlist) {
    return this.pico.playlistItems({
      playlistId: playlist.id,
      maxResults: this.args.maxResults,
      part: ['snippet']
    }).then(extractItems)
      .then(items => Object.assign(playlist, {
        items
      }))
  }

  _getPlaylistsItems (channel) {
    return Promise.all(channel.playlists.map(this._getPlaylistItems)
    )
  }

  detail (id, oldData) {
    switch (this.mode) {
      case YoutubeMode.SHOWS:

        debug('details', oldData)

        return this._getPlaylistItems(oldData)
          .then(playlistItemToShow)
          .then(detail => {
            let ret = Object.assign({}, oldData, detail)
            delete (ret.playlists)
            delete (ret.items)

            return ret
          })
          .then(debugPromise('THE END'))
      default:
        return this.channelPromise
          .then(this._getPlaylistsItems)
          .then(playlistItemsToSeasons)
          .then(detail => Object.assign({}, oldData, detail))
          .then(debugPromise('default'))
    }
  }
}
