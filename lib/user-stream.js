var oauth   = require('oauth'),
    events  = require('events'),
    util    = require("util");

var user_stream_url     = 'https://userstream.twitter.com/1.1/user.json',
    site_stream_url     = 'https://sitestream.twitter.com/1.1/site.json',
    request_token_url   = 'https://api.twitter.com/oauth/request_token',
    access_token_url    = 'https://api.twitter.com/oauth/access_token';

module.exports = Stream;

function Stream(params) {

    if (!(this instanceof Stream)) {
        return new Stream(params);
    }

    events.EventEmitter.call(this);

    this.params = params;

    this.oauth = new oauth.OAuth(
        request_token_url,
        access_token_url,
        this.params.consumer_key,
        this.params.consumer_secret,
        '1.0',
        null,
        'HMAC-SHA1',
        null,
        {
          'Accept': '*/*',
          'Connection'
          : 'close',
          'User-Agent': 'user-stream.js'
        }
    );

}

//inherit
util.inherits(Stream, events.EventEmitter);

/**
 * Create twitter site stream
 *
 * Events:
 * - data
 * - garbage
 * - close
 * - error
 * - connected
 * - heartbeat
 *
 */
Stream.prototype.site_stream = function(user_ids, params) {

    params = params || {};
    params.follow = user_ids.join(",");
    url = params.url || site_stream_url;
    delete params.url;

    this.do_stream(url, params);
}

/**
 * Create twitter user stream
 *
 * Events:
 * - data
 * - garbage
 * - close
 * - error
 * - connected
 * - heartbeat
 *
 */
Stream.prototype.stream = function(params) {
    this.do_stream(user_stream_url, params);
};

Stream.prototype.do_stream = function(url, extra_params) {

    extra_params = extra_params || {};
    extra_params.delimited = 'length';
    extra_params.stall_warnings = 'true';


    var stream = this;

    var request = this.oauth.post(
        url,
        this.params.access_token_key,
        this.params.access_token_secret,
        extra_params,
        null
    );

    /**
     * Destroy socket
     */
    this.destroy = function() {

        request.abort();

    }

    request.on('response', function(response) {

        // Any response code greater then 200 from steam API is an error
        if(response.statusCode > 200) {

            stream.emit('error', {type: 'response', data: {code:response.statusCode}});

        } else {

            var buffer = '',
                next_data_length = 0,
                end = '\r\n';

            //emit connected event
            stream.emit('connected');

            //set chunk encoding
            response.setEncoding('utf8');
            var handle_chunk = function(chunk) {

                //is heartbeat?
                if (chunk == end || chunk.indexOf(end) == 0) {
                    stream.emit('heartbeat');
                    chunk = chunk.slice(end.length);
                    if (chunk.length) {
                       handle_chunk(chunk);
                    }
                    return;
                }

                //check whether new incomming data set
                if (!buffer.length) {
                    //get length of incomming data
                    var line_end_pos = chunk.indexOf(end);
                    next_data_length = parseInt(chunk.slice(0, line_end_pos));
                    //slice data length string from chunk
                    chunk = chunk.slice(line_end_pos+end.length);
                }

                if (buffer.length != next_data_length) {
                    //data set recieved
                    //first remove end and append to buffer
                    buffer+= chunk.slice(0, chunk.indexOf(end));
                    chunk = chunk.slice(chunk.indexOf(end) + end.length);
                    //parse json
                    var parsed = false;
                    try {
                        //try parse & emit
                        buffer = JSON.parse(buffer);
                        parsed = true;
                    } catch(e) {
                        stream.emit('garbage', buffer);
                    }

                    //don't emit into "try" and emit only if data formatted
                    if (parsed) {
                        stream.emit('data', buffer);
                    }

                    //clean buffer
                    buffer = '';
                    if (chunk.length) {
                      handle_chunk(chunk);
                    }

                } else {
                    //append to buffer
                    buffer+=chunk;
                }

            };

            response.on('data', handle_chunk);

            response.on('error', function(error) {

                stream.emit('close', error);

            });

            response.on('end', function() {

                stream.emit('close', 'socket end');

            });


            response.on('close', function() {

                request.abort();

            });
        }

    });

    request.on('error', function(error) {

        stream.emit('error', {type: 'request', data: error});

    });

    request.end();

}