// (C) Copyright 2014-2015 Hewlett-Packard Development Company, L.P.

var data = require('./data');

var RESOURCE_COUNT = 150; //1000;

var SCHEMA = {
  "server-profiles": {
    prefix: "profile",
    resourceAttributes: {
      description: '',
      boot: {
        manageBoot: true,
        order: ['CD', 'floppy']
      }
    },
    associations: {
      "SERVER_PROFILE_TO_NETWORK" : {
        category: "ethernet-networks",
        count: 40,
        share: true
      },
      "SERVER_PROFILE_TO_SERVER_HARDWARE" : {
        category: "server-hardware",
        count: 1,
        share: false
      },
      "SERVER_PROFILE_TO_VOLUME" : {
        category: "volumes",
        count: 3,
        share: false
      }
    }
  },
  "server-hardware": {
    prefix: "enclosure 1, bay",
    indexAttributes: {
      model: {prefix: 'proliant bl460c gen'}
    },
    associations: {
      "SERVER_HARDWARE_TO_SERVER_HARDWARE_TYPE" : {
        category: "server-hardware-types",
        count: 1,
        share: true
      }
    }
  },
  "server-hardware-types": {
    prefix: "server type",
    indexAttributes: {
      model: {prefix: 'proliant bl460c gen'}
    },
    noStatus: true
  },
  "enclosures": {
    prefix: "enclosure",
    resourceAttributes: {
      deviceBays: [{
        bay: 1,
        model: 'abc',
        flavor: null
      },{
        bay: 2,
        model: 'def'
      }]
    },
    associations: {
      "ENCLOSURE_TO_SERVER_HARDWARE" : {
        category: "server-hardware",
        count: 16,
        share: false
      },
      "ENCLOSURE_TO_INTERCONNECT" : {
        category: "switches",
        count: 6,
        share: false
      }
    }
  },
  "switches": {
    prefix: "interconnect",
    indexAttributes: {
      model: 'FlexFabric 10G'
    },
  },
  "ethernet-networks": {
    prefix: "net",
    indexAttributes: {
      vlan: {prefix: '', unique: true}
    }
  },
  "fc-networks": {
    prefix: "san",
    indexAttributes: {
      vlan: {prefix: '', unique: true, start: RESOURCE_COUNT}
    }
  },
  "volumes": {prefix: "volume"},
  "storage-arrays": {prefix: "storage array"},
  "alerts": {
    names: [
      "Temperature threshold exceeded by 10 degrees.",
      "Unable to establish management contact with the service processor.",
      "Inconsistent configuration detected."
    ]
  },
  "tasks": {
    names: ["Add", "Update", "Remove", "Restart"]
  }
};

// derived from http://stackoverflow.com/questions/521295/javascript-random-seeds
var seed = 1234;
function random (scale) {
    var x = Math.sin(seed++) * 10000;
    return Math.round((x - Math.floor(x)) * scale);
}

function distribute (values) {
  var result;
  for (var i=0; i<values.length; i++) {
    if (Array.isArray(values[i])) {
      if (random(values[i][1]) === 0) {
        result = values[i][0];
        break;
      }
    } else {
      result = values[i];
      break;
    }
  }
  return result;
}

function createCategories () {
  for (var categoryName in SCHEMA) {
    if (SCHEMA.hasOwnProperty(categoryName)) {
      data.addCategory(categoryName);
    }
  }
}

function buildMembers (categoryName, count) {
  var category = SCHEMA[categoryName];
  var date = new Date();
  for (var i=1; i<=count; i++) {
    var name;
    if (category.prefix) {
      name = category.prefix + ' ' + i;
    } else if (category.names) {
      name = category.names[i % category.names.length];
    }
    var resource = {
      name: name,
      state: 'Normal',
      uri: '/rest/' + categoryName + '/' + i,
      category: categoryName,
      created: date.toISOString(),
      modified: date.toISOString()
    };

    if (! category.noStatus) {
      resource.status = distribute([['Warning', 7], ['Error', 19], 'OK']);
    }
    date.setDate(date.getDate()-1);

    if (category.indexAttributes) {
      resource._indexAttributes = {};
      for (var attributeName in category.indexAttributes) {
        if (category.indexAttributes.hasOwnProperty(attributeName)) {
          var value = category.indexAttributes[attributeName];
          if (typeof value === 'string') {
            resource._indexAttributes[attributeName] = value;
          } else if (value.hasOwnProperty('prefix')) {
            var index;
            if (value.unique) {
              index = (value.start || 0) + i;
            } else {
              index = ((i % 3) + 1);
            }
            resource._indexAttributes[attributeName] = value.prefix + index;
          }
        }
      }
    }

    if (category.resourceAttributes) {
      resource._resourceAttributes = category.resourceAttributes;
    }

    // ensure alerts for non-OK resources
    if (resource.status && 'OK' !== resource.status) {
      var alerts = SCHEMA.alerts;
      var alert = {
        name: alerts.names[i % alerts.names.length],
        state: 'Active',
        status: resource.status,
        uri: '/rest/alerts/r' + i + '-' + categoryName,
        category: 'alerts',
        created: resource.created,
        modified: resource.modified,
        attributes: {
          associatedResourceCategory: resource.category,
          associatedResourceUri: resource.uri,
          associatedResourceName: resource.name
        }
      };

      data.addResource('alerts', alert);
    }

    data.addResource(categoryName, resource);
  }
}

function createResources () {
  for (var categoryName in SCHEMA) {
    if (SCHEMA.hasOwnProperty(categoryName)) {
      buildMembers(categoryName, RESOURCE_COUNT); // + categoryName.length);
    }
  }
}

function createActivity () {
  // associate alerts and tasks with resources
  var resources = [];
  for (var categoryName in SCHEMA) {
    if (SCHEMA.hasOwnProperty(categoryName) &&
      'alerts' !== categoryName && 'tasks' !== categoryName) {
      resources = resources.concat(data.getMembers(categoryName));
    }
  }

  var index = 0;
  data.getMembers('alerts', true).forEach(function (alert) {
    if ('Active' !== alert.state) {
      var resource = resources[index];
      index += 1;
      alert.attributes = {
        associatedResourceCategory: resource.category,
        associatedResourceUri: resource.uri,
        associatedResourceName: resource.name
      };
      alert.state = 'Cleared';
      alert.status = distribute([['Error', 5], ['Warning', 3], 'OK']);
    }
  });

  index = 0;
  data.getMembers('tasks', true).forEach(function (task) {
    var resource = resources[index];
    index += 1;
    task.attributes = {
      associatedResourceCategory: resource.category,
      associatedResourceUri: resource.uri,
      associatedResourceName: resource.name,
      parentTaskUri: null,
    };
    task.state = distribute([['Running', 13], ['Error', 9], ['Warning', 7], 'Completed']);
    task.status = ('Running' === task.state ? 'Unknown' :
      {'Completed': 'OK', 'Warning': 'Warning', 'Error': 'Error'}[task.state]);
  });
}

function createAssociations() {
  for (var categoryName in SCHEMA) {
    if (SCHEMA.hasOwnProperty(categoryName)) {

      var category = SCHEMA[categoryName];
      if (category.hasOwnProperty('associations')) {

        for (var name in category.associations) {
          if (category.associations.hasOwnProperty(name)) {

            var schema = category.associations[name];
            var parents = data.getMembers(categoryName);
            var children = data.getMembers(schema.category);
            var childIndex = 0;

            parents.forEach(function (parent) {
              for (var i=0; i<schema.count; i++) {
                if (childIndex < children.length) {
                  data.addAssociation(name, parent.uri, children[childIndex].uri);
                  childIndex += 1;
                }
              }
              if (schema.share) {
                childIndex = 0;
              }
            });
          }
        }
      }
    }
  }
}

var Generator = {
  generate: function () {
    createCategories();
    createResources();
    createActivity();
    createAssociations();
  }
};

module.exports = Generator;
