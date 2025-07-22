const fs = require('fs');
const moment = require('moment-timezone');
const BUNDLES_FILE = 'bundles.json';
const BUNDLES_DETAILED_FILE = 'bundleDetailed.json';
const TIMEZONE = 'America/Sao_Paulo';

const getCurrentDataStatus = () => {
    const status = {
        hasBasicBundles: false,
        hasDetailedBundles: false,
        basicBundlesCount: 0,
        detailedBundlesCount: 0,
        lastBasicUpdate: null,
        lastDetailedUpdate: null,
        needsUpdate: false,
        dataAge: null,
        duplicatesDetected: 0
    };
    try {
        if (fs.existsSync(BUNDLES_FILE)) {
            const basicData = JSON.parse(fs.readFileSync(BUNDLES_FILE, 'utf-8'));
            status.hasBasicBundles = true;
            status.basicBundlesCount = basicData.totalBundles || 0;
            const uniqueLinks = new Set();
            const duplicates = [];
            if (basicData.bundles) {
                basicData.bundles.forEach((bundle, index) => {
                    if (uniqueLinks.has(bundle.Link)) {
                        duplicates.push({ index, link: bundle.Link, name: bundle.Nome });
                    } else {
                        uniqueLinks.add(bundle.Link);
                    }
                });
            }
            status.duplicatesDetected = duplicates.length;
        }
        if (fs.existsSync(BUNDLES_DETAILED_FILE)) {
            const detailedData = JSON.parse(fs.readFileSync(BUNDLES_DETAILED_FILE, 'utf-8'));
            status.hasDetailedBundles = true;
            status.detailedBundlesCount = detailedData.totalBundles || 0;
            status.lastDetailedUpdate = detailedData.last_update;
            if (detailedData.last_update) {
                const lastUpdate = moment.tz(detailedData.last_update, TIMEZONE);
                const now = moment().tz(TIMEZONE);
                status.dataAge = now.diff(lastUpdate, 'hours');
                status.needsUpdate = status.dataAge > 168;
            }
        } else {
            status.needsUpdate = true;
        }
        if (status.hasBasicBundles && status.hasDetailedBundles) {
            const difference = Math.abs(status.basicBundlesCount - status.detailedBundlesCount);
            if (difference > 50) {
                status.needsUpdate = true;
            }
        }
    } catch (error) {
        console.error('❌ Erro ao verificar status dos dados:', error);
        status.needsUpdate = true;
    }
    return status;
};

const removeDuplicatesFromBasicBundles = () => {
    try {
        if (!fs.existsSync(BUNDLES_FILE)) {
            console.log('📄 Arquivo de bundles básicas não encontrado.');
            return { removed: 0, total: 0 };
        }
        const data = JSON.parse(fs.readFileSync(BUNDLES_FILE, 'utf-8'));
        const originalCount = data.bundles ? data.bundles.length : 0;
        if (!data.bundles || originalCount === 0) {
            return { removed: 0, total: 0 };
        }
        const uniqueBundles = [];
        const seenLinks = new Set();
        data.bundles.forEach(bundle => {
            if (!seenLinks.has(bundle.Link)) {
                seenLinks.add(bundle.Link);
                uniqueBundles.push(bundle);
            }
        });
        const removedCount = originalCount - uniqueBundles.length;
        if (removedCount > 0) {
            const updatedData = {
                totalBundles: uniqueBundles.length,
                bundles: uniqueBundles,
                lastDeduplication: moment().tz(TIMEZONE).format(),
                duplicatesRemoved: removedCount
            };
            fs.writeFileSync(BUNDLES_FILE, JSON.stringify(updatedData, null, 2), 'utf-8');
            console.log(`🧹 Removidas ${removedCount} bundles duplicadas. Total: ${uniqueBundles.length}`);
        }
        return { removed: removedCount, total: uniqueBundles.length };
    } catch (error) {
        console.error('❌ Erro ao remover duplicatas:', error);
        return { removed: 0, total: 0 };
    }
};

const removeDuplicatesFromDetailedBundles = () => {
    try {
        if (!fs.existsSync(BUNDLES_DETAILED_FILE)) {
            console.log('📄 Arquivo de bundles detalhadas não encontrado.');
            return { removed: 0, total: 0 };
        }
        const data = JSON.parse(fs.readFileSync(BUNDLES_DETAILED_FILE, 'utf-8'));
        const originalCount = data.bundles ? data.bundles.length : 0;
        if (!data.bundles || originalCount === 0) {
            return { removed: 0, total: 0 };
        }
        const uniqueBundles = [];
        const seenIds = new Set();
        const seenLinks = new Set();
        data.bundles.forEach(bundle => {
            const id = bundle.bundleid;
            const link = bundle.link;
            if (!seenIds.has(id) && !seenLinks.has(link)) {
                seenIds.add(id);
                seenLinks.add(link);
                uniqueBundles.push(bundle);
            }
        });
        const removedCount = originalCount - uniqueBundles.length;
        if (removedCount > 0) {
            const updatedData = {
                ...data,
                totalBundles: uniqueBundles.length,
                bundles: uniqueBundles,
                lastDeduplication: moment().tz(TIMEZONE).format(),
                duplicatesRemoved: removedCount
            };
            fs.writeFileSync(BUNDLES_DETAILED_FILE, JSON.stringify(updatedData, null, 2), 'utf-8');
            console.log(`🧹 Removidas ${removedCount} bundles detalhadas duplicadas. Total: ${uniqueBundles.length}`);
        }
        return { removed: removedCount, total: uniqueBundles.length };
    } catch (error) {
        console.error('❌ Erro ao remover duplicatas detalhadas:', error);
        return { removed: 0, total: 0 };
    }
};

module.exports = {
    getCurrentDataStatus,
    removeDuplicatesFromBasicBundles,
    removeDuplicatesFromDetailedBundles
};
