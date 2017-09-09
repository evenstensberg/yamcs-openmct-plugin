const axios = require('axios');

const ENG_TYPES = {
  'UINT32': 'uint32Value',
  'FLOAT': 'floatValue',
  'STRING': 'stringValue',
  'SINT64': 'sint64Value'
};
const DATUM_TYPES = {
  'enumeration': 'enum',
  'string': 'enum',
  'float': 'float',
  'integer': 'integer',
  'boolean': 'boolean'
};

module.exports = define(['axios'], function (axios) {function YamcsPlugin() {
    const names = getDictionary()
      .then(function (dictionary) {
        return dictionary.map(function (param) {
          return param
        })
      });
    function getDictionary() {
      return axios.get('http://localhost:8090/api/mdb/simulator/parameters')
        .then(function (response) {
          return response.data.parameter;
        });
    }
    function transformYamcsToMCT(identifier) {
      const YamcsObject = names.then(param => {
        return param.filter(p => p.name === identifier.key).pop()
      }).then(res => {
        let datumObject = {
          key: "value",
          name: "Value",
          hints: {
            range: 1
          },
          format: res.type ? DATUM_TYPES[res.type.engType] : 'enum'
        }
        if (datumObject.format === "enum") {
          datumObject.enumerations = [
            {
              string: "ENABLED",
              value: 1
            },
            {
              string: "DISABLED",
              value: 0
            }
          ]
        }
        return Promise.resolve(datumObject)
      })
      return YamcsObject
    }
    function getParamForHistorical(identifier) {
      const YamcsObject = names.then(param => {
        return param.filter(p => p.name === identifier.name).pop()
      }).then(res => {
        return Promise.resolve(res.url);
      })
      return YamcsObject
    }

    function getParamInfo(identifier) {
      if (identifier.key === 'parameters') {
        return new Promise(function (resolve, reject) {
          resolve({
            identifier: identifier,
            name: 'Yamcs',
            type: 'folder',
            location: 'ROOT'
          })
        }).then((res) => {
          return res;
        })
      } else {
        return transformYamcsToMCT(identifier, name).then((telemetryDatum) => {
          return {
            identifier: identifier,
            name: identifier.key,
            type: 'yamcs.telemetry',
            telemetry: {
              values: [telemetryDatum, {
                key: "utc",
                source: "timestamp",
                name: "Timestamp",
                format: "utc",
                hints: {
                  domain: 1
                }
              }]
            },
            location: 'yamcs.instance:parameters'
          }
        })
      }
    }

    return function install(openmct) {

      openmct.objects.addRoot({
        namespace: 'yamcs.instance',
        key: 'parameters'
      });

      openmct.objects.addProvider('yamcs.instance', {
        get: function (identifier) {
          return getParamInfo(identifier).then(function (dictionary) {
            return dictionary;
          });
        }
      });

      openmct.composition.addProvider({
        appliesTo: function (domainObject) {
          return domainObject.identifier.namespace === 'yamcs.instance' && domainObject.type === 'folder';
        },
        load: function (domainObject) {
          return names
            .then(name => {
              return name.map(param => {
                return {
                  namespace: 'yamcs.instance',
                  key: param.name
                }
              })
            })
        }
      });

      openmct.types.addType('yamcs.telemetry', {
        name: 'YAMCS Telemetry Point',
        description: 'Telemetry point from YAMCS',
        cssClass: 'icon-telemetry'
      });

      openmct.telemetry.addProvider({
        supportsRequest: function (domainObject) {
          return domainObject.type === 'yamcs.telemetry';
        },
        request: function (domainObject, options) {
          return getParamForHistorical(domainObject).then((url) => {
            return axios.get(url.replace('mdb', 'archive')).then((resp) => {
              if(Object.getOwnPropertyNames(resp.data).length == 0) {
                return [{ timestamp: Date.now(), id: domainObject.name}];
              } else {
                return resp.data.parameter.map((param) => {
                  let key = ENG_TYPES[param.engValue.type];
                  let val = param.engValue[key];
                  return {
                    id: param.id.name,
                    timestamp: param.generationTime,
                    value: val
                  }
                })
              }
            })
          })
        }
      });

      var socket = new WebSocket('ws://localhost:8090/simulator/_websocket');
      var listeners = {};
      socket.onmessage = function (event) {
        let point = JSON.parse(event.data);
        names.then( param => param.filter( p => !!listeners[p.name]).pop())
        .then( (res) => {
            listeners[res.name].forEach(function (l) {
              let incomingArr = point.pop();
              if(typeof incomingArr !== 'object') {
                l({
                  id: res.name
                })
              } else {
              let datum = (incomingArr.data && incomingArr.data.parameter.length !== 0) ? incomingArr.data.parameter.pop() : [];
              let val = null;
              if(datum.length !== 0) {
                 val = datum.engValue[ENG_TYPES[datum.engValue.type]];
              }
              l({
                  id: res.name,
                  value: val
                });
              }
          });
        })
      };

      openmct.telemetry.addProvider({
        supportsSubscribe: function (domainObject) {
          return domainObject.type === 'yamcs.telemetry';
        },
        subscribe: function (domainObject, callback, options) {
          if (!listeners[domainObject.identifier.key]) {
            listeners[domainObject.identifier.key] = [];
          }
          if (!listeners[domainObject.identifier.key].length) {
            names.then(param => {
              return param.filter(p => p.name === domainObject.identifier.key).pop()
            }).then(res => {
                socket.send(JSON.stringify([1, 1, 789, {
                  "parameter": "subscribe",
                  "data": {
                    "list": [
                      { "name": `${res.qualifiedName}` }
                    ]
                  }
                }
                ]
                ))
            })
          }
          listeners[domainObject.identifier.key].push(callback);
          return function () {
            listeners[domainObject.identifier.key] =
              listeners[domainObject.identifier.key].filter(function (c) {
                return c !== callback;
              });
            if (listeners[domainObject.identifier.key].length === 0) {
              socket.send(JSON.stringify([1, 1, 790, { "parameters": "unsubscribe" }]));
            }
          };
        }
      });
    };
  }});