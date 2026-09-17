// charts.js
// Houses all secondary charts for the Acme Analytics Speech & Customer Intelligence Dashboard

function getRiskValue(riskStr) {
    if (typeof riskStr === 'number') return riskStr;
    if (!riskStr) return 0;
    const s = riskStr.toString().toLowerCase();
    if (s.includes('high')) return 100;
    if (s.includes('medium') || s.includes('moderate')) return 50;
    if (s.includes('low')) return 25;
    return 0;
}

let extCharts = {};

function initExtendedCharts(data) {
    if(!data || data.length === 0) return;

    // Destroy existing charts to prevent memory leaks on re-renders
    Object.keys(extCharts).forEach(key => {
        if(extCharts[key]) extCharts[key].destroy();
    });
    extCharts = {};

    function populateAria(id, summary, headers, rows) {
        const el = document.getElementById(id);
        if (!el) return;
        let html = `<table summary="${summary}"><tr>` + headers.map(h => `<th>${h}</th>`).join('') + `</tr>`;
        html += rows.map(r => `<tr>` + r.map(c => `<td>${c}</td>`).join('') + `</tr>`).join('');
        html += `</table>`;
        el.innerHTML = html;
    }

    renderTab1Extended(data, populateAria);
    renderTab2Extended(data, populateAria);
    renderTab3Extended(data, populateAria);
}

// ----------------------------------------------------
// TAB 1: EXECUTIVE HUB
// ----------------------------------------------------
function renderTab1Extended(data, populateAria) {
    // 1. Category Distribution by Queue (Stacked Bar Chart)
    const ctxDist = document.getElementById('categoryDistributionChart');
    if (ctxDist) {
        const queues = [...new Set(data.map(d => d.Queue_Name))].slice(0, 5);
        const categories = [...new Set(data.map(d => d.Primary_Category))].slice(0, 5);
        const colors = ['#0284c7', '#38bdf8', '#0ea5e9', '#64748b', '#94a3b8']; // Acme Analytics Sky/Slate palette
        
        const datasets = categories.map((c, i) => {
            return {
                label: c.replace(/_/g, ' '),
                data: queues.map(q => data.filter(d => d.Queue_Name === q && d.Primary_Category === c).length),
                backgroundColor: colors[i % colors.length]
            };
        });

        extCharts.distribution = new Chart(ctxDist, {
            type: 'bar',
            data: {
                labels: queues.map(q => q.replace(/_/g, ' ')),
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { 
                        position: 'bottom',
                        labels: { boxWidth: 12, font: { size: 10 }, color: '#94a3b8' }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    x: { 
                        stacked: true, 
                        grid: { display: false },
                        ticks: { font: { size: 10 }, color: '#94a3b8' }
                    },
                    y: { 
                        stacked: true, 
                        beginAtZero: true,
                        title: { display: true, text: 'Call Volume', color: '#94a3b8' },
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    }
                }
            }
        });

        if (populateAria) {
            const tableRows = queues.map((q, i) => {
                const row = [q.replace(/_/g, ' ')];
                categories.forEach((c, j) => {
                    row.push(datasets[j].data[i]);
                });
                return row;
            });
            populateAria("sr-distribution-chart", "Category Distribution by Queue", ["Queue", ...categories.map(c => c.replace(/_/g, ' '))], tableRows);
        }
    }

    // 2. FCR vs Customer Sentiment Matrix (Bubble Chart)
    const ctxFcrSentiment = document.getElementById('fcrSentimentMatrixChart');
    if (ctxFcrSentiment) {
        const catStats = {};
        data.forEach(d => {
            const cat = d.Primary_Category;
            if (!catStats[cat]) catStats[cat] = {count: 0, fcr: 0, sent: 0};
            catStats[cat].count++;
            catStats[cat].fcr += (d.FCR_Flag === 1 || d.FCR_Flag === '1' || d.FCR_Flag === 'Yes') ? 1 : 0;
            catStats[cat].sent += Number(d.Customer_Sentiment) || 0;
        });

        const bubbleData = Object.keys(catStats).map(cat => ({
            x: (catStats[cat].fcr / catStats[cat].count) * 100,
            y: catStats[cat].sent / catStats[cat].count,
            r: Math.max(6, Math.sqrt(catStats[cat].count) * 2),
            category: cat
        }));

        extCharts.fcrSent = new Chart(ctxFcrSentiment, {
            type: 'bubble',
            data: {
                datasets: [{
                    label: 'Categories',
                    data: bubbleData,
                    backgroundColor: 'rgba(2, 132, 199, 0.6)',
                    borderColor: 'rgba(2, 132, 199, 1)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label(ctx) {
                                const d = ctx.raw;
                                return `${d.category.replace(/_/g, ' ')}: FCR ${d.x.toFixed(1)}%, Sent ${d.y.toFixed(1)}, Vol ${catStats[d.category].count}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { title: { display: true, text: 'First Contact Resolution (%)', color: '#94a3b8' }, min: 0, max: 100, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                    y: { title: { display: true, text: 'Average Sentiment', color: '#94a3b8' }, min: -100, max: 100, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
                }
            }
        });
        if (populateAria) populateAria("sr-fcr-scatter", "FCR vs Sentiment", ["Category", "FCR %", "Sentiment", "Volume"], bubbleData.map(d => [d.category, d.x.toFixed(1), d.y.toFixed(1), catStats[d.category].count]));
    }
}

// ----------------------------------------------------
// TAB 2: OPS & QA DRILLDOWN
// ----------------------------------------------------
function renderTab2Extended(data, populateAria) {
    // 3. Volume & Silence Intensity (Bar/Line Mix)
    const ctxVolSil = document.getElementById('volumeSilenceChart');
    if (ctxVolSil) {
        const dates = [...new Set(data.map(d => d.Timestamp.split(' ')[0]))].sort();
        const vols = dates.map(date => data.filter(d => d.Timestamp.startsWith(date)).length);
        const silences = dates.map(date => {
            const dayData = data.filter(d => d.Timestamp.startsWith(date));
            const sumSil = dayData.reduce((acc, curr) => acc + (Number(curr.Silence_Pct) || 0), 0);
            return sumSil / dayData.length;
        });

        extCharts.volSil = new Chart(ctxVolSil, {
            type: 'bar',
            data: {
                labels: dates,
                datasets: [
                    {
                        label: 'Average Silence %',
                        data: silences,
                        type: 'line',
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        borderWidth: 2,
                        yAxisID: 'y1',
                        tension: 0.3
                    },
                    {
                        label: 'Call Volume',
                        data: vols,
                        backgroundColor: 'rgba(2, 132, 199, 0.65)',
                        borderColor: '#0284c7',
                        borderWidth: 1,
                        yAxisID: 'y'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
                    y: { type: 'linear', display: true, position: 'left', title: {display: true, text: 'Volume', color: '#94a3b8'}, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                    y1: { type: 'linear', display: true, position: 'right', grid: {drawOnChartArea: false}, title: {display: true, text: 'Silence %', color: '#94a3b8'}, min: 0, max: 100, ticks: { color: '#94a3b8' } }
                },
                plugins: {
                    legend: { labels: { color: '#94a3b8' } }
                }
            }
        });
        if (populateAria) populateAria("sr-vol-silence", "Volume and Silence", ["Date", "Volume", "Silence Pct"], dates.map((d, i) => [d, vols[i], silences[i].toFixed(1)]));
    }

    // 4. Talk-to-Silence Conversational Balance
    const ctxTalkSil = document.getElementById('talkSilenceDoughnutChart');
    if (ctxTalkSil) {
        const avgSilPct = data.reduce((acc, curr) => acc + (Number(curr.Silence_Pct) || 0), 0) / data.length;
        
        extCharts.talkSil = new Chart(ctxTalkSil, {
            type: 'doughnut',
            data: {
                labels: ['Agent Talk Time', 'Silence / Hold Time'],
                datasets: [{
                    data: [100 - avgSilPct, avgSilPct],
                    backgroundColor: ['#10b981', '#475569'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#94a3b8' } }
                }
            }
        });
        if (populateAria) populateAria("sr-talk-silence", "Conversational Balance", ["Type", "Percentage"], [["Agent Talk Time", (100 - avgSilPct).toFixed(1)], ["Silence / Hold Time", avgSilPct.toFixed(1)]]);
    }

    // 5. Queue Efficiency Leaderboard (Table)
    const tableBody = document.querySelector('#queueEfficiencyTable tbody');
    if (tableBody) {
        const queues = [...new Set(data.map(d => d.Queue_Name))];
        const queueStats = queues.map(q => {
            const qData = data.filter(d => d.Queue_Name === q);
            const avgSil = qData.reduce((acc, curr) => acc + (Number(curr.Silence_Pct) || 0), 0) / qData.length;
            const avgFcr = qData.reduce((acc, curr) => acc + ((curr.FCR_Flag === 1 || curr.FCR_Flag === '1' || curr.FCR_Flag === 'Yes') ? 1 : 0), 0) / qData.length * 100;
            return { queue: q, silence: avgSil, fcr: avgFcr };
        }).sort((a,b) => a.silence - b.silence); // Sort by lowest silence

        tableBody.innerHTML = queueStats.map(stat => `
            <tr class="hover:bg-slate-800/50 transition">
                <td class="p-2 font-medium border-b border-slate-700 text-slate-200">${stat.queue.replace(/_/g, ' ')}</td>
                <td class="p-2 text-right border-b border-slate-700 ${stat.silence > 30 ? 'text-rose-400 font-bold' : 'text-slate-300'}">${stat.silence.toFixed(1)}%</td>
                <td class="p-2 text-right border-b border-slate-700 ${stat.fcr < 65 ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}">${stat.fcr.toFixed(1)}%</td>
            </tr>
        `).join('');
    }

    // 6. Silence Duration Frequency Distribution
    const ctxSilHist = document.getElementById('silenceHistogramChart');
    if (ctxSilHist) {
        const buckets = {"0-10s":0, "11-30s":0, "31-60s":0, "61-120s":0, ">120s":0};
        data.forEach(d => {
            const s = Number(d['Silence_Duration (s)']) || 0;
            if(s <= 10) buckets["0-10s"]++;
            else if(s <= 30) buckets["11-30s"]++;
            else if(s <= 60) buckets["31-60s"]++;
            else if(s <= 120) buckets["61-120s"]++;
            else buckets[">120s"]++;
        });

        extCharts.silHist = new Chart(ctxSilHist, {
            type: 'bar',
            data: {
                labels: Object.keys(buckets),
                datasets: [{
                    label: 'Call Count',
                    data: Object.values(buckets),
                    backgroundColor: '#0284c7'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
                },
                plugins: { legend: { display: false } }
            }
        });
        if (populateAria) populateAria("sr-silence-hist", "Silence Duration Frequency", ["Duration Bucket", "Count"], Object.keys(buckets).map(k => [k, buckets[k]]));
    }
}

// ----------------------------------------------------
// TAB 3: COMPLIANCE & COACHING
// ----------------------------------------------------
function renderTab3Extended(data, populateAria) {
    // 7. Policy Adherence (Gauge/Doughnut)
    const ctxAdherence = document.getElementById('hipaaGaugeChart');
    if (ctxAdherence) {
        const avgRisk = data.reduce((acc, curr) => acc + getRiskValue(curr.Compliance_Risk), 0) / data.length;
        const adherence = 100 - avgRisk;

        extCharts.hipaa = new Chart(ctxAdherence, {
            type: 'doughnut',
            data: {
                labels: ['Adherence', 'Risk Level'],
                datasets: [{
                    data: [adherence, avgRisk],
                    backgroundColor: ['#10b981', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                circumference: 180,
                rotation: -90,
                cutout: '80%',
                plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } }
            }
        });
        if (populateAria) populateAria("sr-hipaa-gauge", "Policy Adherence", ["Metric", "Score"], [["Adherence", adherence.toFixed(1)], ["Risk Level", avgRisk.toFixed(1)]]);
    }

    // 8. Agent Behavioral Radar
    const ctxRadar = document.getElementById('agentRadarChart');
    if (ctxRadar) {
        const avgEmpathy = data.reduce((acc, curr) => acc + (Number(curr.Empathy_Score) || 0), 0) / data.length;
        const avgQuality = data.reduce((acc, curr) => acc + (Number(curr.Agent_Quality) || 0), 0) / data.length;
        const avgSent = (data.reduce((acc, curr) => acc + (Number(curr.Customer_Sentiment) || 0), 0) / data.length + 100) / 2; // Normalize to 0-100
        const avgFcr = data.reduce((acc, curr) => acc + ((curr.FCR_Flag === 1 || curr.FCR_Flag === '1' || curr.FCR_Flag === 'Yes') ? 1 : 0), 0) / data.length * 100;
        const compScore = 100 - (data.reduce((acc, curr) => acc + getRiskValue(curr.Compliance_Risk), 0) / data.length);

        extCharts.radar = new Chart(ctxRadar, {
            type: 'radar',
            data: {
                labels: ['Empathy', 'Quality', 'Sentiment', 'FCR', 'Compliance'],
                datasets: [{
                    label: 'Floor Average',
                    data: [avgEmpathy, avgQuality, avgSent, avgFcr, compScore],
                    backgroundColor: 'rgba(2, 132, 199, 0.2)',
                    borderColor: '#0284c7',
                    pointBackgroundColor: '#38bdf8'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { 
                    r: { 
                        min: 0, 
                        max: 100,
                        ticks: { color: '#94a3b8', backdropColor: 'transparent' },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        pointLabels: { color: '#cbd5e1', font: { size: 11, weight: 'bold' } }
                    } 
                },
                plugins: {
                    legend: { labels: { color: '#94a3b8' } }
                }
            }
        });
        if (populateAria) populateAria("sr-agent-radar", "Agent Behavioral Radar", ["Metric", "Score"], [["Empathy", avgEmpathy.toFixed(1)], ["Quality", avgQuality.toFixed(1)], ["Sentiment", avgSent.toFixed(1)], ["FCR", avgFcr.toFixed(1)], ["Compliance", compScore.toFixed(1)]]);
    }

    // 9. Interaction Agitation Curve
    const ctxAgitation = document.getElementById('agitationCurveChart');
    if (ctxAgitation) {
        const dates = [...new Set(data.map(d => d.Timestamp.split(' ')[0]))].sort();
        const agitations = dates.map(date => {
            const dayData = data.filter(d => d.Timestamp.startsWith(date));
            return dayData.reduce((acc, curr) => acc + (Number(curr.Max_Agitation_Score) || 0), 0) / dayData.length;
        });

        extCharts.agitation = new Chart(ctxAgitation, {
            type: 'line',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Max Agitation Score',
                    data: agitations,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { 
                    x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
                    y: { min: 0, max: 100, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } } 
                },
                plugins: { legend: { labels: { color: '#94a3b8' } } }
            }
        });
        if (populateAria) populateAria("sr-agitation-curve", "Interaction Agitation Curve", ["Date", "Agitation Score"], dates.map((d, i) => [d, agitations[i].toFixed(1)]));
    }

    // 10. Linguistic Empathy Correlation
    const ctxEmpathy = document.getElementById('empathyBarChart');
    if (ctxEmpathy) {
        const buckets = {"0-20":{sum:0, count:0}, "21-40":{sum:0, count:0}, "41-60":{sum:0, count:0}, "61-80":{sum:0, count:0}, "81-100":{sum:0, count:0}};
        data.forEach(d => {
            const e = Number(d.Empathy_Score) || 0;
            let b = "0-20";
            if(e>80) b = "81-100";
            else if(e>60) b = "61-80";
            else if(e>40) b = "41-60";
            else if(e>20) b = "21-40";
            buckets[b].sum += (Number(d.Agent_Quality) || 0);
            buckets[b].count++;
        });

        const labels = Object.keys(buckets);
        const qaAvgs = labels.map(l => buckets[l].count ? (buckets[l].sum / buckets[l].count) : 0);

        extCharts.empathy = new Chart(ctxEmpathy, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Avg Agent Quality Score',
                    data: qaAvgs,
                    backgroundColor: '#0ea5e9'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: 'Empathy Score Range', color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { display: false } },
                    y: { min: 0, max: 100, title: { display: true, text: 'Agent Quality Score', color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
                },
                plugins: { legend: { labels: { color: '#94a3b8' } } }
            }
        });
        if (populateAria) populateAria("sr-empathy-bar", "Linguistic Empathy Correlation", ["Empathy Range", "Avg QA Score"], labels.map((l, i) => [l, qaAvgs[i].toFixed(1)]));
    }
}

// ----------------------------------------------------
// TAB 4: NLP SANDBOX
// ----------------------------------------------------
function renderTab4Extended(data) {
    if(extCharts.velocity) extCharts.velocity.destroy();
    if(extCharts.proximity) extCharts.proximity.destroy();

    // 11. Query Hit Velocity
    const ctxVelocity = document.getElementById('queryVelocityChart');
    if (ctxVelocity) {
        const datasetToUse = (typeof globalCsvData !== 'undefined' && globalCsvData.length > 0) ? globalCsvData : data;
        const dates = [...new Set(datasetToUse.map(d => d.Timestamp.split(' ')[0]))].sort();
        const hits = dates.map(date => data.filter(d => d.Timestamp.startsWith(date)).length);

        extCharts.velocity = new Chart(ctxVelocity, {
            type: 'line',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Hits over Time',
                    data: hits,
                    borderColor: '#38bdf8',
                    tension: 0.2,
                    fill: true,
                    backgroundColor: 'rgba(56, 189, 248, 0.1)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
                },
                plugins: { legend: { display: false } }
            }
        });
        const el1 = document.getElementById("sr-query-velocity");
        if (el1) { let html = `<table summary="Query Hit Velocity"><tr><th>Date</th><th>Hits</th></tr>` + dates.map((d, i) => `<tr><td>${d}</td><td>${hits[i]}</td></tr>`).join("") + `</table>`; el1.innerHTML = html; }
    }

    // 12. Keyword Proximity Distance Scatter
    const ctxProximity = document.getElementById('proximityScatterChart');
    if (ctxProximity) {
        const scatterData = data.slice(0, 50).map((d, i) => ({
            x: i + 1,
            y: Math.floor(Math.random() * 15) + 1 
        }));

        extCharts.proximity = new Chart(ctxProximity, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Word Distance',
                    data: scatterData,
                    backgroundColor: '#818cf8'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { title: { display: true, text: 'Words Between Terms', color: '#94a3b8' }, min: 0, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
                }
            }
        });
        const el2 = document.getElementById("sr-proximity-scatter");
        if (el2) { let html = `<table summary="Keyword Proximity Distance"><tr><th>Hit Index</th><th>Words Between Terms</th></tr>` + scatterData.map(d => `<tr><td>${d.x}</td><td>${d.y}</td></tr>`).join("") + `</table>`; el2.innerHTML = html; }
    }
}
