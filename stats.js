/**
 * Speech Analytics KPI & Insights Engine (Sanitized Portfolio Edition)
 * Computes global and filtered statistical metrics across contact center datasets.
 */

function humanizeCategory(id) {
    if (!id) return '';
    return id.replace(/_/g, ' ');
}

function formatDateDisplay(dateStr) {
    // Input: YYYY-MM-DD
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function computeDatasetStats(rows) {
    const validRows = (rows || []).filter(r => r.Timestamp);
    if (validRows.length === 0) return null;

    const stats = {
        rowCount: validRows.length,
        dateMin: '',
        dateMax: '',
        formattedDateMin: '',
        formattedDateMax: '',
        topCategory: '',
        topCategoryRaw: '',
        worstSilenceCategory: '',
        worstSilenceCategoryRaw: '',
        meanSilencePct: 0,
        meanSentiment: 0,
        meanFCR: 0,
        peakDay: '',
        spike: false,
        deltas: null
    };

    // Date range
    const dates = validRows.map(r => r.Timestamp.split(' ')[0]).sort();
    stats.dateMin = dates[0];
    stats.dateMax = dates[dates.length - 1];
    stats.formattedDateMin = formatDateDisplay(stats.dateMin);
    stats.formattedDateMax = formatDateDisplay(stats.dateMax);

    // Global Means & Categories
    let totalSilence = 0;
    let totalSentiment = 0;
    let totalFCR = 0;
    
    const catCounts = {};
    const catSilence = {};
    const dailyVolume = {};

    validRows.forEach(row => {
        totalSilence += Number(row.Silence_Pct) || 0;
        totalSentiment += Number(row.Customer_Sentiment) || 0;
        
        // Handle FCR varying formats
        const fcrRaw = row.FCR_Flag;
        if (fcrRaw === 'Yes' || fcrRaw === '1' || fcrRaw === 1 || fcrRaw === true || fcrRaw === 'TRUE') {
            totalFCR += 1;
        }

        const cat = row.Primary_Category;
        if (cat) {
            catCounts[cat] = (catCounts[cat] || 0) + 1;
            if (!catSilence[cat]) catSilence[cat] = { sum: 0, count: 0 };
            catSilence[cat].sum += Number(row.Silence_Pct) || 0;
            catSilence[cat].count += 1;
        }

        const date = row.Timestamp.split(' ')[0];
        dailyVolume[date] = (dailyVolume[date] || 0) + 1;
    });

    stats.meanSilencePct = totalSilence / validRows.length;
    stats.meanSentiment = totalSentiment / validRows.length;
    stats.meanFCR = (totalFCR / validRows.length) * 100;

    // Top Category
    let maxCount = -1;
    for (const cat in catCounts) {
        if (catCounts[cat] > maxCount) {
            maxCount = catCounts[cat];
            stats.topCategoryRaw = cat;
            stats.topCategory = humanizeCategory(cat);
        }
    }

    // Worst Silence Category (min 5 rows)
    let maxSilenceMean = -1;
    for (const cat in catSilence) {
        if (catSilence[cat].count >= 5) {
            const mean = catSilence[cat].sum / catSilence[cat].count;
            if (mean > maxSilenceMean) {
                maxSilenceMean = mean;
                stats.worstSilenceCategoryRaw = cat;
                stats.worstSilenceCategory = humanizeCategory(cat);
            }
        }
    }

    // Peak day & Spike detection
    const uniqueDays = Object.keys(dailyVolume).sort();
    let peakVol = -1;
    for (const d in dailyVolume) {
        if (dailyVolume[d] > peakVol) {
            peakVol = dailyVolume[d];
            stats.peakDay = d;
        }
    }

    if (uniqueDays.length >= 3) {
        const vols = Object.values(dailyVolume).sort((a,b) => a - b);
        const mid = Math.floor(vols.length / 2);
        const medianVol = vols.length % 2 !== 0 ? vols[mid] : (vols[mid - 1] + vols[mid]) / 2;
        
        if (peakVol >= 1.5 * medianVol) {
            stats.spike = true;
        }
    }

    // Deltas (early vs late third, calendar days)
    const spanDays = Math.floor((new Date(stats.dateMax + 'T00:00:00') - new Date(stats.dateMin + 'T00:00:00')) / (1000 * 60 * 60 * 24)) + 1;
    
    if (spanDays >= 3) {
        const minTime = new Date(stats.dateMin + 'T00:00:00').getTime();
        const maxTime = new Date(stats.dateMax + 'T00:00:00').getTime();
        const thirdDuration = (maxTime - minTime) / 3;
        
        const earlyEnd = minTime + thirdDuration;
        const lateStart = minTime + 2 * thirdDuration;

        let earlyRows = [];
        let lateRows = [];

        validRows.forEach(row => {
            const t = new Date(row.Timestamp.split(' ')[0] + 'T00:00:00').getTime();
            if (t <= earlyEnd) {
                earlyRows.push(row);
            } else if (t >= lateStart) {
                lateRows.push(row);
            }
        });

        const calcMeans = (arr) => {
            if (arr.length === 0) return { vol: 0, sil: 0, sen: 0, fcr: 0 };
            let sil = 0, sen = 0, fcr = 0;
            arr.forEach(r => {
                sil += Number(r.Silence_Pct) || 0;
                sen += Number(r.Customer_Sentiment) || 0;
                const rFcr = r.FCR_Flag;
                fcr += (rFcr === 'Yes' || rFcr === '1' || rFcr === 1 || rFcr === true || rFcr === 'TRUE') ? 1 : 0;
            });
            return {
                vol: arr.length,
                sil: sil / arr.length,
                sen: sen / arr.length,
                fcr: (fcr / arr.length) * 100
            };
        };

        const early = calcMeans(earlyRows);
        const late = calcMeans(lateRows);

        if (early.vol > 0 && late.vol > 0) {
            stats.deltas = {
                volumePct: ((late.vol - early.vol) / early.vol) * 100,
                silencePts: late.sil - early.sil,
                sentimentPts: late.sen - early.sen,
                fcrPts: late.fcr - early.fcr
            };
        }
    }

    return stats;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        computeDatasetStats,
        formatDateDisplay,
        humanizeCategory
    };
}
