export const postmanFixture = {
  info: { _postman_id: 'abc', name: 'Demo API', description: 'A demo', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: ['console.log("col pre")'] } }],
  variable: [{ key: 'baseUrl', value: 'https://api.example.com', type: 'string' }],
  item: [
    {
      name: 'Users',
      item: [
        {
          name: 'List users',
          event: [{ listen: 'test', script: { exec: ['pm.test("ok", () => pm.response.to.have.status(200));'] } }],
          request: {
            method: 'GET',
            header: [{ key: 'Accept', value: 'application/json' }],
            url: { raw: '{{baseUrl}}/users?page=1&limit=10', host: ['{{baseUrl}}'], path: ['users'], query: [{ key: 'page', value: '1' }, { key: 'limit', value: '10', disabled: true }] },
          },
          response: [
            {
              name: 'OK',
              originalRequest: { method: 'GET', url: '{{baseUrl}}/users' },
              status: 'OK',
              code: 200,
              header: [{ key: 'Content-Type', value: 'application/json' }],
              body: '[{"id":1}]',
            },
          ],
          protocolProfileBehavior: { followRedirects: false, strictSSL: false },
        },
        {
          name: 'Create user',
          request: {
            method: 'POST',
            auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }, { key: 'password', value: 'p' }] },
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: { mode: 'raw', raw: '{"name":"Ann"}', options: { raw: { language: 'json' } } },
            url: '{{baseUrl}}/users',
          },
        },
        {
          name: 'Get user',
          request: { method: 'GET', url: { raw: '{{baseUrl}}/users/:id', host: ['{{baseUrl}}'], path: ['users', ':id'], variable: [{ key: 'id', value: '1' }] } },
        },
      ],
    },
    {
      name: 'Upload',
      request: {
        method: 'POST',
        url: 'https://api.example.com/upload',
        body: { mode: 'formdata', formdata: [{ key: 'file', type: 'file', src: '/tmp/a.png' }, { key: 'note', value: 'hi', type: 'text' }] },
      },
    },
  ],
}
