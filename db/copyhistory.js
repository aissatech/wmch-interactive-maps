"use strict";
/**
 * Usage: node copydb.js
 */
/** old database */
const localconfig = require('../localconfig');

const oldModels = require('./models');
const oldDb = require(`./connector/${localconfig.databaseOldProd.engine}`);
var parseArgs = require('minimist');
var opts;  // strict with named arguments on parseArgs needs this
const argv = parseArgs(process.argv, opts={boolean: ['force']});

/** new database */
const {migrate, connection, Map, History, Category, MapCategory} = require("./modelsB.js");

if (!argv['force']) {
    console.log("For one-time use only to migrate contents. WARNING use --force WILL DESTROY current database.");  // uncomment this and below to use
    process.exit(1);
}
const legacyDb = async function() {
    let dbMeta = new oldDb.Database(localconfig.databaseOldProd);
    const Map = dbMeta.db.define('map', oldModels.Map);
    const History = dbMeta.db.define('history', oldModels.History);
    Map.hasMany(History); // 1 : N
    // skip sync, read only
    return {"oldDbMeta": dbMeta, "OldMap": Map, "OldHistory": History}
};

(async() => {
    // Old ///////////////////
    const {oldDbMeta, OldMap, OldHistory} = await legacyDb(oldModels)
    console.log("Reading maps")
    const maps = await OldMap.findAll({
        order: [
            ['createdAt', 'ASC']
        ]
    })
    // New ///////////////////
    // populate tables from database to databaseB
    const mapIds = []
    for (const record of maps) {
        const data = record.dataValues
        mapIds.push(data.id)
    }
    console.log("Importing histories...")
    const chunk = 50
    // History: remove elements to not import
    mapIds.splice(mapIds.indexOf(1), 1);
    mapIds.splice(mapIds.indexOf(2), 1);
    // process all chunked elements
    for (const mapId of mapIds) {            
        let histories = []
        // Chunk import
        for (let offset = 0; histories.length || offset === 0; offset = offset + chunk) {
            console.log(`Importing ${offset + chunk} histories offset`)
            // SELECT id, createdAt, updatedAt FROM interactivemaps.histories h WHERE h.mapId = 1 AND diff AND NOT error
            histories = await OldHistory.findAll({
                where: {
                    // diff: true,
                    // error: false,
                    mapId: mapId
                },
                limit: chunk,
                offset: offset,
                order: [
                    ['createdAt', 'ASC']
                ]
            })
            const newHistories = []
            for (const record of histories) {
                newHistories.push(record.dataValues)
            }
            await History.bulkCreate(newHistories)
        }
    }
    console.log("Import History complete")
    console.log()
    // close connection (must be the last line)
    await connection.close()
    await oldDbMeta.db.close()  // ineffective old close
})();