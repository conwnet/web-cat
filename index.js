/**
 * @file web-cat
 * @author netcon
 */

const fs = require('fs');
const path = require('path');
const url = require('url');
const http = require('http');

/* utils */

// function with nothing
const noop = () => {};

// get absolute path from relativePath
const absolute = relativePath => path.join(__dirname, relativePath);

// fold the string, 12345 => 51423
const fold = str => {
    let result = '';
    const length = str.length;
    const middle = length >> 1;

    for (let i = 0; i < middle; i++) {
        result += str.charAt(length - i - 1) + str.charAt(i);
    }

    return (length & 1) ? result + str[middle] : result;
};

// convert number to 36 based charactor
const mapCode = (letterCodeBase => {
    return code => code < 10
        ? code + ''
        : String.fromCharCode(code - 10 + letterCodeBase);
})('a'.charCodeAt(0));

// convert 10 based string to 36 based string
const convert = str => {
    let result = '';
    let value = Number.parseInt(str, 10);

    while (value > 0) {
        result = mapCode(value % 36) + result;
        value = Number.parseInt(value / 36);
    }

    return result;
};

// generate a unique hash based timestamp (1ms)
const hash = () => fold(convert(fold(Date.now() + '')));

/* logger */

const ENABLE_LOGGER = false;
const errorLogPath = absolute('./error.log');
const infoLogPath = absolute('./info.log');

// save log
const logger = ({method, url}, info) => {
    if (!ENABLE_LOGGER) {
        return;
    }

    const logPath = (info instanceof Error) ? errorLogPath : infoLogPath;
    const record = [(new Date()).toISOString(), method, url, info.toString()].join(' ') + '\n';

    fs.appendFile(logPath, record, noop);
}

/* server */

const MAX_DATA_LENGTH = 1024 * 64;
const validPathRegExp = /^\/[a-zA-Z0-9]*$/;
const validMethods = ['GET', 'POST', 'DELETE', 'OPTIONS'];
const homePagePath = absolute('./index.html');
const dataDirPath = absolute('./data');

// quick set response
const reply = (res, {status = 200, headers = {}, data = ''} = {}) => {
    const body = (typeof data === 'object' && !Buffer.isBuffer(data))
        ? JSON.stringify(data)
        : data;

    res.writeHead(status, headers);
    res.end(body);
};

// server implement
const server = http.createServer((req, res) => {
    const {pathname} = url.parse(req.url);

    // handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    // test path if valid
    if (!validPathRegExp.test(pathname) || !validMethods.includes(req.method)) {
        return reply(res, {
            status: 403,
            data: {code: 4030, message: 'Forbidden'}
        });
    }

    if (req.method === 'GET') {
        // handle router GET /
        if (pathname === '/') {
            return fs.readFile(homePagePath, (err, buf) => {
                if (err) {
                    return reply(res, {
                        status: 404,
                        data: {code: 4040, message: 'Home page not found'}
                    });
                }

                reply(res, {
                    headers: {'Content-Type': 'text/html'},
                    data: buf
                });
            });
        }

        // handle route GET /:path
        const dataPath = path.join(dataDirPath, pathname);

        return fs.readFile(dataPath, (err, buf) => {
            if (err) {
                return reply(res, {
                    status: 404,
                    data: {code: 4041, message: 'Data not exists'}
                });
            }

            const sepIndex = buf.indexOf('\n');
            const headers = {'Content-Type': buf.slice(0, sepIndex)};

            reply(res, {headers, data: buf.slice(sepIndex + 1)});
        });
    }

    if (req.method === 'POST') {
        // read data, ignore overlength char
        let body = (req.headers['content-type'] || 'text/plain') + '\n';
        req.on('data', chunk => {
            if (body.length < MAX_DATA_LENGTH) {
                body += chunk;
            }
            if (body.length >= MAX_DATA_LENGTH) {
                body = body.slice(0, MAX_DATA_LENGTH);
            }
        });

        return req.on('end', () => {
            // handle route POST /
            if (pathname === '/') {
                const dataKey = hash();
                const dataPath = path.join(dataDirPath, dataKey);

                return fs.writeFile(dataPath, body, err => {
                    if (err) {
                        logger(req, err);
                        return reply(res, {
                            status: 500,
                            data: {code: 5000, message: 'Something seems wrong'}
                        });
                    }

                    reply(res, {data: {code: 0, message: 'OK',  data: dataKey}});
                });
            }

            // handle route POST /:path
            const dataPath = path.join(dataDirPath, pathname);

            return fs.access(dataPath, err => {
                if (err) {
                    return reply(res, {
                        status: 404,
                        data: {code: 4041, message: 'Data not exists'}
                    });
                }

                fs.writeFile(dataPath, body, err => {
                    if (err) {
                        logger(req, err);
                        return reply(res, {
                            status: 500,
                            data: {code: 5001, message: 'Something seems wrong'}
                        });
                    }

                    reply(res, {data: {code: 0, message: 'OK'}});
                });
            });

        });
    }

    if (req.method === 'DELETE') {
        if (pathname === '/') {
            return reply(res, {status: 403, data: {code: 4031, message: 'Forbidden'}});
        }

        const dataPath = path.join(dataDirPath, pathname);
        return fs.unlink(dataPath, err => {
            if (err) {
                return reply(res, {
                    status: 404,
                    data: {code: 4041, message: 'Data not exists'}
                });
            }

            reply(res, {data: {code: 0, message: 'OK'}});
        });
    }

    res.end();
});

server.listen(process.env.PORT || 3000);

