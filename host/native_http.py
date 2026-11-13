"""HTTP transport for reactc protocol hosts on POSIX.

Requests: {origin, path, method, headers?: [[name, value], ...], body?: text}.
native.http.read carries GET and HEAD; native.http.write carries POST, PUT,
PATCH, DELETE and OPTIONS. Results: {ok, status, statusText, headers, body}.
"""
import http.client
import re
from urllib.parse import urlsplit


BODY_LIMIT = 65536
REQUEST_LIMIT = 65536
HEADER_LIMIT = 8192
ORIGIN = re.compile(r'https?://(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::[0-9]{1,5})?')
PATH = re.compile(r'/(?!/)[!-~]*')
TOKEN = re.compile(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+")
FORBIDDEN = re.compile(r'(?:accept-charset|accept-encoding|access-control-request-headers|'
                       r'access-control-request-method|connection|content-length|cookie2|date|dnt|expect|'
                       r'host|keep-alive|origin|referer|te|trailer|transfer-encoding|upgrade|via|proxy-.*|sec-.*)')
READ = ('GET', 'HEAD')
WRITE = ('POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS')


def request_headers(value):
    if value is None:
        return {}
    if not isinstance(value, list) or len(value) > 64:
        raise ValueError('Invalid headers')
    headers, size = {}, 0
    for pair in value:
        if (not isinstance(pair, list) or len(pair) != 2 or not all(isinstance(part, str) for part in pair)
                or not TOKEN.fullmatch(pair[0]) or FORBIDDEN.fullmatch(pair[0].lower())
                or any(character in pair[1] for character in '\0\r\n')):
            raise ValueError('Invalid header')
        size += len(pair[0]) + len(pair[1]) + 4
        headers[pair[0]] = pair[1]
    if size > HEADER_LIMIT:
        raise ValueError('Headers exceed native HTTP limits')
    return headers


def read_http(request):
    action = request.get('action')
    if request.get('version') != 1 or action not in ('native.http.read', 'native.http.write'):
        return {'ok': False, 'error': 'This host has no handler for the requested action'}
    args = request.get('args')
    if not isinstance(args, dict):
        return {'ok': False, 'error': 'Invalid native HTTP request'}
    origin, path, method = (args.get(key) for key in ('origin', 'path', 'method'))
    methods = READ if action == 'native.http.read' else WRITE
    try:
        headers = request_headers(args.get('headers'))
        body = args.get('body')
        if body is not None and (method in READ or not isinstance(body, str) or '\0' in body
                                 or len(body.encode('utf-8')) > REQUEST_LIMIT):
            raise ValueError('Invalid body')
    except ValueError:
        return {'ok': False, 'error': 'Invalid native HTTP request'}
    if (not isinstance(origin, str) or len(origin) > 256 or not ORIGIN.fullmatch(origin)
            or not isinstance(path, str) or len(path) > 2048 or not PATH.fullmatch(path)
            or '\\' in path or '#' in path or method not in methods):
        return {'ok': False, 'error': 'Invalid native HTTP request'}

    connection = None
    try:
        url = urlsplit(origin)
        if url.port == 0:
            raise ValueError('Port zero')
        connect = http.client.HTTPSConnection if url.scheme == 'https' else http.client.HTTPConnection
        connection = connect(url.hostname, url.port, timeout=5)
        connection.request(method, path, body=None if body is None else body.encode('utf-8'), headers=headers)
        response = connection.getresponse()
        payload = response.read(BODY_LIMIT + 1)
        if len(payload) > BODY_LIMIT or b'\0' in payload:
            raise ValueError('Body exceeds native HTTP limits')
        if method != 'HEAD' and response.length:
            raise ValueError('Incomplete HTTP body')
        return {
            'ok': True, 'status': response.status, 'statusText': response.reason,
            'headers': [[name.lower(), value] for name, value in response.getheaders()],
            'body': payload.decode('utf-8'),
        }
    except (OSError, ValueError, UnicodeDecodeError, http.client.HTTPException):
        return {'ok': False, 'error': 'Native HTTP request failed'}
    finally:
        if connection is not None:
            connection.close()
