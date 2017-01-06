var request = require("request");
var yaml = require("js-yaml");
var fs = require("fs-extra");
var path  = require("path");
var stringify = require('json-stable-stringify');
var unidecode = require('unidecode'); 

var DataPacksExpand = module.exports = function(vlocity) {
    var self = this;
    self.vlocity = vlocity || {};
    self.utils = self.vlocity.datapacksutils;
    
    self.vlocityKeysToNewNamesMap = {};
    self.vlocityRecordSourceKeyMap = {};
};

DataPacksExpand.prototype.generateFolderPath = function(dataPackType, parentName) {
    var self = this;
    //Replace spaces with dash (-) to have a valid file name for cards
    var validParentName = parentName.replace(/\s+/g, "-");
    return self.targetPath + "/" + dataPackType + "/" + validParentName + "/";
};

//Generate the full file path
DataPacksExpand.prototype.generateFilepath = function(dataPackType, parentName, filename, extension) {
    var self = this;
    //Replace spaces with dash (-) to have a valid file name for cards
    var validFileName = filename.replace(/\s+/g, "-");
    return self.generateFolderPath(dataPackType, parentName) + validFileName + "." + extension;
};

DataPacksExpand.prototype.getNameWithFields = function(nameFields, dataPackData) {
    var self = this;
    var filename = "";

    nameFields.forEach(function(key) {

        if (filename != "") {
            filename += "_";
        }

        // If key references a field adds that otherwise is literal string
        if (dataPackData[key]) {
             filename += unidecode(dataPackData[key].replace(/\//g, "-"));
        } else {
            filename += key;
        }
    });

    return filename;
};

DataPacksExpand.prototype.getDataPackName = function(dataPackType, sObjectType, dataPackData) {
    var self = this;
    return self.getNameWithFields(self.utils.getFileName(dataPackType, sObjectType), dataPackData);
};

DataPacksExpand.prototype.expandDatapackElement = function(datapackElement) {
    var self = this;

    if (self.utils.isValidType(datapackElement.VlocityDataPackType)) {
        var dataField = self.utils.getDataField(datapackElement);
        var dataPackData = datapackElement[dataField];

        if (dataPackData) {
            self.processDataPackData(datapackElement.VlocityDataPackType, null, null, dataPackData[0]);
        }
    } 
};

DataPacksExpand.prototype.processList = function(dataPackType, parentName, filename, listData) {
    var self = this;

    if (listData.length > 0) {

        var sObjectType = listData[0].VlocityRecordSObjectType;
      
        listData.forEach(function(dataPack) {
            self.processObjectEntry(dataPackType, dataPack);
        });

        var sortFields = self.utils.getSortFields(dataPackType, sObjectType);
        var fileType = self.utils.getFileType(dataPackType, sObjectType);

        listData.sort(function(a, b) {
            return self.listSortBy(a, b, sortFields, 0);
        });

        var dataPackName = self.getDataPackName(dataPackType, sObjectType, listData[0]);
        var packName;

        if (!parentName) {
            parentName = dataPackName;
        }
    
        if (filename) {
            packName = filename + "_" + dataPackName;
        } else {
            packName = dataPackName;
        }

        return self.writeFile(dataPackType, parentName, packName, fileType, listData);
    }
};

DataPacksExpand.prototype.listSortBy = function(obj1, obj2, fieldsArray, fieldsArrayIndex) {
    var self = this;
    if (stringify(obj1[fieldsArray[fieldsArrayIndex]]) < stringify(obj2[fieldsArray[fieldsArrayIndex]])) {
        return -1;
    }
    
    if (stringify(obj1[fieldsArray[fieldsArrayIndex]]) > stringify(obj2[fieldsArray[fieldsArrayIndex]])) {
        return 1;
    }

    if (fieldsArrayIndex == fieldsArray.length-1) {
        return 0;
    }

    return this.listSortBy(obj1, obj2, fieldsArray, fieldsArrayIndex+1);
};

DataPacksExpand.prototype.processObjectEntry = function(dataPackType, dataPackData)
{
    var self = this;
    var sObjectType = dataPackData.VlocityRecordSObjectType;
    
    var defaultFilterFields = self.utils.getFilterFields();

    defaultFilterFields.forEach(function(field) {
        delete dataPackData[field];
    });

    var filterFields = self.utils.getFilterFields(dataPackType, sObjectType);

    if (filterFields) {
        filterFields.forEach(function(field) {
            delete dataPackData[field];
        });
    }

    var jsonFields = self.utils.getJsonFields(dataPackType, sObjectType);

    if (jsonFields) {
        jsonFields.forEach(function(field) {
            if (typeof dataPackData[field] === "string") {

                try {
                    dataPackData[field] = JSON.parse(dataPackData[field]);
                } catch (e) {
                    console.log(field, e);
                }
            }
        });
    }
};

DataPacksExpand.prototype.preprocessDataPack = function(currentData, dataPackKey) {

    var self = this;

    if (currentData) {
       
        if (Array.isArray(currentData)) {
            currentData.forEach(function(childData) {
                self.preprocessDataPack(childData, dataPackKey);
            });

        } else {

            if (currentData.VlocityRecordSObjectType) {

                // Must already be found
                if (currentData.VlocityMatchingRecordSourceKey) {
                    currentData.VlocityMatchingRecordSourceKey = this.vlocityRecordSourceKeyMap[currentData.VlocityMatchingRecordSourceKey];
                } else {

                    var keyFields = self.utils.getSourceKeyDefinitionFields(currentData.VlocityRecordSObjectType);

                    var newSourceKey = dataPackKey + "/" + currentData.VlocityRecordSObjectType;

                    keyFields.forEach(function(keyField) {
                        newSourceKey += "/" + currentData[keyField];
                    });

                    self.vlocityRecordSourceKeyMap[currentData.VlocityRecordSourceKey] = newSourceKey;

                    if (currentData.Id) {
                        this.vlocityRecordSourceKeyMap[currentData.Id] = newSourceKey;
                    }

                    if (currentData.VlocityRecordSourceKey) {
                        currentData.VlocityRecordSourceKey = newSourceKey;
                    }

                    if (currentData.VlocityLookupRecordSourceKey) {
                        currentData.VlocityLookupRecordSourceKey = newSourceKey;
                    }
                }
            }

            if (currentData.VlocityDataPackData) {

                var dataPackType = currentData.VlocityDataPackType;
               
                if (self.utils.isValidType(dataPackType)) {
                    var dataField = self.utils.getDataField(currentData);
                    var dataPackDataChild = currentData.VlocityDataPackData[dataField];

                    if (dataPackDataChild) {

                        // Top level is always an array with 1 element
                        dataPackDataChild = dataPackDataChild[0];

                        var parentName = this.getDataPackName(dataPackType, dataPackDataChild.VlocityRecordSObjectType, dataPackDataChild);

                        this.vlocityKeysToNewNamesMap[currentData.VlocityDataPackKey] = dataPackType + "/" + parentName;
                    }

                    dataPackKey = dataPackType + "/" + parentName;
                }
            }

            Object.keys(currentData).forEach(function(sobjectField) {
                if (typeof currentData[sobjectField] === "object") {
                    self.preprocessDataPack(currentData[sobjectField], dataPackKey);
                } else if (self.vlocityRecordSourceKeyMap[currentData[sobjectField]]) {
                    // This attempts to replace any Id with a SourceKey
                    currentData[sobjectField] = self.vlocityRecordSourceKeyMap[currentData[sobjectField]];
                }
            });
        }
    }
};

DataPacksExpand.prototype.processDataPack = function(dataPackData, options) {

    var self = this;
    if (dataPackData.VlocityDataPackData) {

        var dataPackType = dataPackData.VlocityDataPackType;

        if ((!options.manifestOnly || self.utils.isInManifest(dataPackData.VlocityDataPackData, options.manifest)) && self.utils.isValidType(dataPackType)) {

            var dataField = self.utils.getDataField(dataPackData);

            var dataPackDataChild = dataPackData.VlocityDataPackData[dataField];

            if (dataPackDataChild) {

                // Top level is always an array with 1 element
                dataPackDataChild = dataPackDataChild[0];

                var parentName = this.getDataPackName(dataPackType, dataPackDataChild.VlocityRecordSObjectType, dataPackDataChild);
                
                fs.emptyDirSync(this.generateFolderPath(dataPackType, parentName));

                if (dataPackData.VlocityDataPackParents && dataPackData.VlocityDataPackParents.length > 0) {
                    var sanitizedParentKeys = [];

                    dataPackData.VlocityDataPackParents.forEach(function(parentKey) {
                        if (self.vlocityKeysToNewNamesMap[parentKey]) {
                            sanitizedParentKeys.push(self.vlocityKeysToNewNamesMap[parentKey]);
                        }
                    });

                    if (sanitizedParentKeys.length > 0) {
                        self.writeFile(dataPackType, parentName, parentName + "_ParentKeys","json", sanitizedParentKeys);
                    }
                }

                if (dataPackData.VlocityDataPackAllRelationships) {
                    var sanitizedRels = {};

                    Object.keys(dataPackData.VlocityDataPackAllRelationships).forEach(function(relKey) {
                        if (self.vlocityKeysToNewNamesMap[relKey]) {
                            sanitizedRels[self.vlocityKeysToNewNamesMap[relKey]] = dataPackData.VlocityDataPackAllRelationships[relKey];
                        }
                    });

                    if (Object.keys(sanitizedRels).length > 0) {
                        self.writeFile(dataPackType, parentName, parentName + "_AllRelationshipKeys", "json", sanitizedRels);
                    }
                }

                self.processDataPackData(dataPackType, parentName, null, dataPackDataChild);
            }
        }
    }
}


DataPacksExpand.prototype.processDataPackData = function(dataPackType, parentName, filename, dataPackData) {
    var self = this;

    if (dataPackData) {

       if (dataPackData.VlocityRecordSObjectType) {

            var sObjectType = dataPackData.VlocityRecordSObjectType;

            var currentObjectName = this.getDataPackName(dataPackType, sObjectType, dataPackData);
            
            var packName;
            var nameExtension = '';
            var fileType;

            if (filename) {
                packName = filename + "_" + currentObjectName;
                fileType = self.utils.getFileType(dataPackType, sObjectType);
            } else {
                packName = currentObjectName;
                nameExtension = "_DataPack";
                fileType = "json";
            }

            var dataPackMetadata = {};

            this.processObjectEntry(dataPackType, dataPackData);
           
            Object.keys(dataPackData).forEach(function(sobjectField) {

                if (self.utils.isValidSObject(dataPackType, sObjectType)) {
                    var expansionType = self.utils.getExpandedDefinition(dataPackType, sObjectType, sobjectField);
                    
                    if (expansionType) {

                        var extension = expansionType;
                        var filenameKeys;
                        
                        if (expansionType.FileType) {
                            filenameKeys = expansionType.FileName; 
                            extension = expansionType.FileType;
                            expansionType = expansionType.FileType;
                        }

                        var expansionData = dataPackData[sobjectField];
                        if (expansionData) {
                            if (expansionType == "list") {
                                dataPackMetadata[sobjectField] = self.processList(dataPackType, parentName, packName, expansionData);
                            } else if (expansionType == "object") {
                                var listExpansion = [];

                                expansionData.forEach(function(childInList) {
                                    listExpansion.push(self.processDataPackData(dataPackType, parentName, packName, childInList));
                                });

                                if (expansionData.length == 1) {
                                    dataPackMetadata[sobjectField] = listExpansion[0];
                                } else if (expansionData.length > 1) {
                                    dataPackMetadata[sobjectField] = listExpansion;
                                }
                            } else {
                                // Skip compiled fields
                                if (self.compileOnBuild && self.utils.isCompiledField(dataPackType, sObjectType, sobjectField)) {
                                    return;
                                }

                                var encoding;

                                var dataFileName = packName;

                                if (filenameKeys) {
                                    dataFileName += "_" + self.getNameWithFields(filenameKeys, dataPackData);
                                }

                                if (expansionType == "base64") {
                                    encoding = "base64";
                                    
                                    if (dataPackData[extension]) {
                                        extension = dataPackData[extension];
                                    }
                                } 

                                dataPackMetadata[sobjectField] = self.writeFile(dataPackType, parentName, dataFileName, extension, expansionData, encoding);
                            }
                        }
                    } else {
                        dataPackMetadata[sobjectField] = dataPackData[sobjectField];
                    }
                }
            });

            return this.writeFile(dataPackType, parentName, packName + nameExtension, fileType, dataPackMetadata);
        }
    }
};

DataPacksExpand.prototype.writeFile = function(dataPackType, parentName, filename, fileType, fileData, encoding) {
    var self = this;
    if (fileType == "json") {
        if (typeof fileData === "object") {
            fileData = stringify(fileData, { space: 4 });
        } else {
            try {
                fileData = stringify(JSON.parse(fileData), { space: 4 });
            } catch (e) {
                console.log("Error: " + filename + "." + fileType, e);
            }
        }
    }

    // File Path should have "Project Name"
    var fullFilePath = this.generateFilepath(dataPackType, parentName, filename, fileType);

    if (!encoding) {
        encoding = 'utf8';
    }

    fs.outputFileSync(fullFilePath, fileData, { "encoding": encoding });
    console.log(fullFilePath + " file created");

    return filename.replace(/\s+/g, "-") + "." + fileType;
};

DataPacksExpand.prototype.expandFile = function(targetPath, expandFile, options) {
    var self = this;
    
    try {
        self.expand(targetPath, JSON.parse(fs.readFileSync(expandFile, 'utf8')), options);
    } catch (e) {
        console.log("Invalid DataPackFile " + expandFile + ' ' + e.message);
    }
};

DataPacksExpand.prototype.expand = function(targetPath, dataPackData, options) {
    var self = this;
    self.compileOnBuild = options.compileOnBuild;
    self.targetPath = targetPath;
    if (dataPackData.dataPacks) {

        dataPackData.dataPacks.forEach(function(dataPack) {
            self.preprocessDataPack(dataPack);
        });

        dataPackData.dataPacks.forEach(function(dataPack) {
            self.processDataPack(dataPack, options);
        });
    }
};
