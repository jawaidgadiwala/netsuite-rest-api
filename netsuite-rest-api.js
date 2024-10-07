const got = require('got');
const { debuglog } = require('util');
const { Readable } = require('stream');
const { headers } = require('./auth');

const restPath = 'services/rest';

const suitesqlPath = `${restPath}/query/v1/suiteql`;
const workbookPath = `${restPath}/query/v1/workbook`;
const datasetPath = `${restPath}/query/v1/dataset`;
const salesOrderPath = `${restPath}/record/v1/salesOrder`;
const purchaseOrderPath = `${restPath}/record/v1/purchaseOrder`;
const cashSalePath = `${restPath}/record/v1/cashSale`;
const expandAbleSubResourcesQueryParam = 'expandSubResources=true';

const debug = debuglog('netsuite-rest-api');

function validateRequestConfig(config) {
  const requiredKeys = [
    'netsuiteApiHost',
    'consumerKey',
    'consumerSecret',
    'netsuiteAccountId',
    'netsuiteTokenKey',
    'netsuiteTokenSecret',
  ];
  const missingKeys = [];
  requiredKeys.forEach((key) => {
    if (!Object.keys(config).includes(key) || !config[key]) {
      missingKeys.push(key);
    }
  });
  if (missingKeys.length) {
    throw new Error(
      `Netsuite Rest API missing one or more keys: ${missingKeys.join(',')}`,
    );
  }
}

function validateRequestData({ method, requestType }) {
  if (!method) {
    throw new Error('Request method required');
  }
  if (!requestType) {
    throw new Error('Request type required');
  }
}

const makeRequest = async (
  config,
  { query, path = '', method, nextUrl = undefined, requestType },
) => {
  validateRequestConfig(config);
  const {
    netsuiteApiHost,
    netsuiteQueryLimit = 10,
    testEnv = false,
    timeout,
  } = config;
  const protocol = testEnv ? 'http' : 'https';

  validateRequestData({ method, requestType });
  let url;

  if (['suiteql', 'workbook'].includes(requestType)) {
    const p =
      requestType === 'workbook'
        ? `${workbookPath}/${query}/result`
        : suitesqlPath;
    url =
      nextUrl ||
      `${protocol}://${netsuiteApiHost}/${p}?limit=${netsuiteQueryLimit}&offset=0`;
  } else if (requestType === 'dataset') {
    url =
      nextUrl ||
      `${protocol}://${netsuiteApiHost}/${datasetPath}/${query}/result?limit=${netsuiteQueryLimit}&offset=0`;
  } else if (requestType === 'record') {
    url = `${protocol}://${netsuiteApiHost}/${path}`;
  } else {
    throw new Error('Unrecognized request type');
  }

  const requestData = {
    url,
    method,
  };
  debug('Request Data : %O', requestData);

  const authHeader = headers(requestData, config);
  debug('headers : %s', authHeader);
  const options = {
    ...requestData,
    headers: {
      ...authHeader,
      'Accept-Language': 'en',
      'Content-Language': 'en',
      'Content-type': 'application/json; charset=utf-8',
      prefer: 'transient',
    },
    throwHttpErrors: false,
    http2: true,
    responseType: 'json',
  };
  if (requestType === 'suiteql') {
    options.json = { q: query };
  } else if (requestType === 'record' && query) {
    options.json = query;
  }
  if (timeout) {
    options.timeout = timeout;
  }
  debug('options : %O', options);
  return got(options);
};

function getErrorMessage(body) {
  let errMsg;
  if (!body) {
    return errMsg;
  }
  const { 'o:errorDetails': errorDetails } = body;
  if (errorDetails && Array.isArray(errorDetails) && errorDetails.length) {
    const [errorDetail] = errorDetails;
    if (errorDetail) {
      errMsg = errorDetail.detail;
    }
  }
  return errMsg;
}

const suiteqlSearch = (config, { query, workbook, dataset }) => {
  const { netsuiteApiHost: host, netsuiteQueryLimit = 10 } = config;
  const stream = new Readable({
    objectMode: true,
    read() {},
  });

  const exec = async () => {
    let hasMore = true;
    let nextUrl = `https://${host}/${suitesqlPath}?limit=${netsuiteQueryLimit}&offset=0`;
    let method = 'POST';
    let requestType = 'suiteql';
    let err;

    if (workbook && dataset) {
      err = new Error('workbook and dataset cannot be used together');
    }

    if (workbook) {
      requestType = 'workbook';
      nextUrl = `https://${host}/${workbookPath}/${workbook}/result?limit=${netsuiteQueryLimit}&offset=0`;
      method = 'GET';
    } else if (dataset) {
      requestType = 'dataset';
      nextUrl = `https://${host}/${datasetPath}/${dataset}/result?limit=${netsuiteQueryLimit}&offset=0`;
      method = 'GET';
    }

    while (!err && hasMore === true) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await makeRequest(config, {
          query,
          method,
          requestType,
          nextUrl,
        });
        const { statusCode, body } = response;
        if (statusCode < 200 || statusCode >= 400) {
          let errMsg = getErrorMessage(body);
          if (!errMsg) {
            errMsg = 'unknown error returned from makeRequest()';
          }
          throw new Error(errMsg);
        }
        debug('Result : ', body);
        const {
          hasMore: doContinue,
          items,
          offset,
          links,
          totalResults,
        } = body;
        if (offset === 0) {
          debug('Total orders returned : ', totalResults);
          stream.emit('totalResults', totalResults);
        }
        if (doContinue) {
          nextUrl = links.find((link) => link.rel === 'next').href;
          debug('Next URL : ', nextUrl);
        }
        if (Array.isArray(items)) {
          items.forEach((item) => stream.push(item));
        }
        hasMore = doContinue;
      } catch (error) {
        debug('Error with request:', error);
        err = error;
      }
    }
    if (err) {
      stream.emit('error', err);
    } else {
      stream.push(null);
    }
  };
  exec();
  return stream;
};

const update = async (config, { id, updateValues, path }) => {
  if (!id) {
    debug('\nMissing Id');
    throw new Error(`id required to update`);
  }
  if (!updateValues) {
    debug('\nMissing update parameters');
    throw new Error('updateValues to update');
  }

  if (!path) {
    debug('\nMissing path');
    throw new Error('path to update');
  }

  return makeRequest(config, {
    method: 'PATCH',
    requestType: 'record',
    query: updateValues,
    path: `${path}/${id}`,
  });
};

module.exports = {
  makeRequest,
  suiteqlSearch,
  suitesqlPath,
  salesOrderPath,
  purchaseOrderPath,
  expandAbleSubResourcesQueryParam,
  update,
  cashSalePath,
  workbookPath,
};
