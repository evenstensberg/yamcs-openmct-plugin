/*****************************************************************************
 * Open MCT, Copyright (c) 2014-2017, United States Government
 * as represented by the Administrator of the National Aeronautics and Space
 * Administration. All rights reserved.
 *
 * Open MCT is licensed under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 *
 * Open MCT includes source code licensed under additional open source
 * licenses. See the Open Source Licenses file (LICENSES.md) included with
 * this source code distribution or the Licensing information page available
 * at runtime from the About dialog for additional information.
 *****************************************************************************/

const ENG_TYPES = {
  UINT32: 'uint32Value',
  FLOAT: 'floatValue',
  STRING: 'stringValue',
  SINT64: 'sint64Value'
};
const DATUM_TYPES = {
  enumeration: 'enum',
  string: 'enum',
  float: 'float',
  integer: 'integer',
  boolean: 'boolean'
};

export default function YamcsPlugin(options) {
  
  const host = options.host || 'localhost';
  const port = options.port || '8090';
  const instance = options.instance || 'simulator';

  const TELEMETRY = getDictionary().then(function(dictionary) {
    return dictionary.map(function(param) {
      return param;
    });
  });
  function getDictionary() {
    return axios
      .get(`http://${host}:${port}/api/mdb/${instance}/parameters`)
      .then(response => response.data.parameter);
  }
  function transformYamcsToMCT(identifier) {
    const YamcsObject = TELEMETRY.then(param =>
      param.filter(p => p.name === identifier.key).pop()
    ).then(res => {
      const datumObject = {
        key: 'value',
        name: 'Value',
        hints: {
          range: 1
        },
        format: res.type ? DATUM_TYPES[res.type.engType] : 'enum'
      };
      if (datumObject.format === 'enum') {
        datumObject.enumerations = [
          {
            string: 'ENABLED',
            value: 1
          },
          {
            string: 'DISABLED',
            value: 0
          }
        ];
      }
      return Promise.resolve(datumObject);
    });
    return YamcsObject;
  }
  function getParamForHistorical(identifier) {
    return TELEMETRY.then(param => param.filter(p => p.name === identifier.name).pop()).then(res =>
      Promise.resolve(res.url)
    );
  }

  function getParamInfo(identifier) {
    if (identifier.key === 'parameters') {
      return new Promise((resolve, reject) => {
        resolve({
          identifier: identifier,
          name: 'Yamcs',
          type: 'folder',
          location: 'ROOT'
        });
      }).then(res => res);
    } else {
      return transformYamcsToMCT(identifier).then(telemetryDatum => {
        return {
          identifier: identifier,
          name: identifier.key,
          type: 'yamcs.telemetry',
          telemetry: {
            values: [
              telemetryDatum,
              {
                key: 'utc',
                source: 'timestamp',
                name: 'Timestamp',
                format: 'utc',
                hints: {
                  domain: 1
                }
              }
            ]
          },
          location: 'yamcs.instance:parameters'
        };
      });
    }
  }

  return function install(openmct) {
    openmct.objects.addRoot({
      namespace: 'yamcs.instance',
      key: 'parameters'
    });

    openmct.objects.addProvider('yamcs.instance', {
      get: function(identifier) {
        return getParamInfo(identifier).then(dictionary => dictionary);
      }
    });

    openmct.composition.addProvider({
      appliesTo: function(domainObject) {
        return (
          domainObject.identifier.namespace === 'yamcs.instance' && domainObject.type === 'folder'
        );
      },
      load: function() {
        return TELEMETRY.then(name =>
          name.map(param => {
            return {
              namespace: 'yamcs.instance',
              key: param.name
            };
          })
        );
      }
    });

    openmct.types.addType('yamcs.telemetry', {
      name: 'YAMCS Telemetry Point',
      description: 'Telemetry point from YAMCS',
      cssClass: 'icon-telemetry'
    });

    openmct.telemetry.addProvider({
      supportsRequest: function(domainObject) {
        return domainObject.type === 'yamcs.telemetry';
      },
      request: function(domainObject) {
        return getParamForHistorical(domainObject).then(url => {
          return axios.get(url.replace('mdb', 'archive')).then(resp => {
            if (Object.getOwnPropertyNames(resp.data).length === 0) {
              return [{ timestamp: Date.now(), id: domainObject.name }];
            } else {
              return resp.data.parameter.map(param => {
                const key = ENG_TYPES[param.engValue.type];
                const val = param.engValue[key];
                return {
                  id: param.id.name,
                  timestamp: param.generationTime,
                  value: val
                };
              });
            }
          });
        });
      }
    });
    const socket = new WebSocket(`ws://${host}:${port}/${instance}/_websocket`); // eslint-disable-line
    const listeners = {};
    socket.onmessage = function(event) {
      const point = JSON.parse(event.data);
      TELEMETRY.then(param => param.filter(p => !!listeners[p.name]).pop()).then(res => {
        listeners[res.name].forEach(function(l) {
          const incomingArr = point.pop();
          if (typeof incomingArr !== 'object') {
            l({
              id: res.name
            });
          } else {
            const datum =
              incomingArr.data && incomingArr.data.parameter.length !== 0
                ? incomingArr.data.parameter.pop()
                : [];
            let val = null;
            if (datum.length !== 0) {
              val = datum.engValue[ENG_TYPES[datum.engValue.type]];
            }
            l({
              id: res.name,
              value: val
            });
          }
        });
      });
    };

    openmct.telemetry.addProvider({
      supportsSubscribe: function(domainObject) {
        return domainObject.type === 'yamcs.telemetry';
      },
      subscribe: function(domainObject, callback) {
        if (!listeners[domainObject.identifier.key]) {
          listeners[domainObject.identifier.key] = [];
        }
        if (!listeners[domainObject.identifier.key].length) {
          TELEMETRY.then(param =>
            param.filter(p => p.name === domainObject.identifier.key).pop()
          ).then(res => {
            socket.send(
              JSON.stringify([
                1,
                1,
                789,
                {
                  parameter: 'subscribe',
                  data: {
                    list: [{ name: `${res.qualifiedName}` }]
                  }
                }
              ])
            );
          });
        }
        listeners[domainObject.identifier.key].push(callback);
        return function() {
          listeners[domainObject.identifier.key] = listeners[domainObject.identifier.key].filter(
            c => c !== callback
          );
          if (listeners[domainObject.identifier.key].length === 0) {
            socket.send(JSON.stringify([1, 1, 790, { parameters: 'unsubscribe' }]));
          }
        };
      }
    });
  };
}
