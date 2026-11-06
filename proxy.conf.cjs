module.exports = [
  {
    context: ['/api', '/health'],
    target: 'http://127.0.0.1:8080',
    secure: false,
    changeOrigin: true,
    configure: proxy => proxy.on('proxyReq', proxyRequest => proxyRequest.removeHeader('origin')),
  },
];
