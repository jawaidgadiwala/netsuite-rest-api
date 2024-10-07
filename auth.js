const OAuth = require('oauth-1.0a');
const crypto = require('crypto');

const auth = (config) =>
  OAuth({
    ...config,
    signature_method: 'HMAC-SHA256',
    hash_function(baseString, key) {
      return crypto
        .createHmac('sha256', key)
        .update(baseString)
        .digest('base64');
    },
    nonce_length: 20,
  });

const setToken = (config) => ({
  key: config.netsuiteTokenKey,
  secret: config.netsuiteTokenSecret,
});

const setConfig = (config) => {
  const consumer = {
    key: config.consumerKey,
    secret: config.consumerSecret,
  };
  return {
    realm: config.netsuiteAccountId,
    consumer,
  };
};

const headers = (requestData, config = {}) => {
  const headerConfig = setConfig(config);
  const token = setToken(config);
  const oauth = auth(headerConfig);
  return oauth.toHeader(oauth.authorize(requestData, token));
};

module.exports = {
  headers,
};
