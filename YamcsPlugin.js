define(
  ['axios'],
  function YamcsPlugin(axios) {

    const names = getDictionary()
      .then(function (dictionary) {
        return dictionary.map(function (param) {
          return param
        });
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
        let resType = res.type ? res.type.engType : "string";
        let returnObj = {
          key: "value",
          name: "Value",
          hints: {
            range: 1
          }
        }
        if (resType === "enumeration" || resType === "string") {
          returnObj.format = "enum";
          returnObj.enumerations = [
            {
              string: "ENABLED",
              value: 1
            },
            {
              string: "DISABLED",
              value: 0
            }
          ]
        } else {
          returnObj.format = resType;
        }
        return Promise.resolve(returnObj)
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
              return resp.data.parameter.map((param) => {
                let val;
                if (param.engValue.floatValue) {
                  val = param.engValue.floatValue
                }
                else if (param.engValue.stringValue) {
                  val = (param.engValue.stringValue === 'ENABLED') ? 1 : 0
                }
                else if (param.engType.uint32Value) {
                  val = param.engType.uint32Value
                }
                return {
                  id: param.id.name,
                  timestamp: param.generationTime,
                  value: val
                }
              })
            })
          })
        }
      });

      var socket = new WebSocket('ws://localhost:8090/simulator/_websocket');
      var listeners = {};
      socket.onmessage = function (event) {
        point = JSON.parse(event.data);
        names.then( param => param.filter( p => !!listeners[p.name]).pop())
        .then( (res) => {
            listeners[res.name].forEach(function (l) {
              let incomingArr = point.pop()
              console.log(incomingArr)
              if(typeof incomingArr !== 'object') {
                l({
                  id: res.name
                })
              } else {
                let datum = incomingArr.data.parameter.pop()
              let datumObj = {
                  id: res.name,
                  value: datum.engValue.floatValue
              }
            l(datumObj);
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

            if (!listeners[domainObject.identifier.key].length) {
              socket.send(JSON.stringify([1, 1, 790, { "parameter": "unsubscribe" }]));
            }
          };
        }
      });
    };
  });