// ── Verified stage data — Gronze.com, cross-checked against Brierley's guide ──
// Last verified 2026-06-22. Town-to-town distances only (intra-stage hamlets not yet verified).
const STAGE_TABLE = [
  { from: 'Saint-Jean-Pied-de-Port', to: 'Roncesvalles', km: 24.2 },
  { from: 'Roncesvalles', to: 'Zubiri', km: 21.4 },
  { from: 'Zubiri', to: 'Pamplona', km: 20.4 },
  { from: 'Pamplona', to: 'Puente la Reina', km: 23.9 },
  { from: 'Puente la Reina', to: 'Estella', km: 21.6 },
  { from: 'Estella', to: 'Los Arcos', km: 21.3 },
  { from: 'Los Arcos', to: 'Logroño', km: 27.6 },
  { from: 'Logroño', to: 'Nájera', km: 29.0 },
  { from: 'Nájera', to: 'Santo Domingo de la Calzada', km: 20.7 },
  { from: 'Santo Domingo de la Calzada', to: 'Belorado', km: 22.0 },
  { from: 'Belorado', to: 'San Juan de Ortega', km: 23.9 },
  { from: 'San Juan de Ortega', to: 'Burgos', km: 25.8 },
  { from: 'Burgos', to: 'Hornillos del Camino', km: 20.3 },
  { from: 'Hornillos del Camino', to: 'Castrojeriz', km: 19.9 },
  { from: 'Castrojeriz', to: 'Frómista', km: 24.7 },
  { from: 'Frómista', to: 'Carrión de los Condes', km: 18.8 },
  { from: 'Carrión de los Condes', to: 'Terradillos de los Templarios', km: 26.3 },
  { from: 'Terradillos de los Templarios', to: 'Bercianos del Real Camino', km: 23.2 },
  { from: 'Bercianos del Real Camino', to: 'Mansilla de las Mulas', km: 26.3 },
  { from: 'Mansilla de las Mulas', to: 'León', km: 18.5 },
  { from: 'León', to: 'San Martín del Camino', km: 24.6 },
  { from: 'San Martín del Camino', to: 'Astorga', km: 23.7 },
  { from: 'Astorga', to: 'Foncebadón', km: 25.8 },
  { from: 'Foncebadón', to: 'Ponferrada', km: 26.8 },
  { from: 'Ponferrada', to: 'Villafranca del Bierzo', km: 23.2 },
  { from: 'Villafranca del Bierzo', to: 'O Cebreiro', km: 27.8 },
  { from: 'O Cebreiro', to: 'Triacastela', km: 20.6 },
  { from: 'Triacastela', to: 'Sarria', km: 17.8 },
  { from: 'Sarria', to: 'Portomarín', km: 22.2 },
  { from: 'Portomarín', to: 'Palas de Rei', km: 24.8 },
  { from: 'Palas de Rei', to: 'Arzúa', km: 28.5 },
  { from: 'Arzúa', to: 'O Pedrouzo', km: 19.3 },
  { from: 'O Pedrouzo', to: 'Santiago de Compostela', km: 19.4 },
];

// Build a lookup of cumulative km at arrival for every named stop in the table
function buildCumulativeMap() {
  const map = { 'saint-jean-pied-de-port': 0 };
  let cum = 0;
  for (const stage of STAGE_TABLE) {
    cum += stage.km;
    map[normalize(stage.to)] = cum;
  }
  return map;
}

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Find verified anchor points (real, sourced distances) near the given start location
function findAnchors(location) {
  const cumMap = buildCumulativeMap();
  const key = normalize(location);
  const startCum = cumMap[key];

  if (startCum === undefined) return null; // start isn't a major verified stage town — skip anchors, AI uses its own knowledge

  // Find the next 1-2 major stage towns after this point
  const sorted = Object.entries(cumMap).sort((a, b) => a[1] - b[1]);
  const ahead = sorted.filter(([name, cum]) => cum > startCum).slice(0, 2);
  if (!ahead.length) return null;

  return { startCum, ahead };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const { prompt, useSearch, location } = req.body || {};

    if (!prompt) {
      res.status(400).json({ error: 'Missing "prompt" in request body.' });
      return;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
      return;
    }

    let finalPrompt = prompt;

    // Inject verified, sourced distance anchors when the start matches a known major stage town
    if (location) {
      const anchors = findAnchors(location);
      if (anchors) {
        const lines = anchors.ahead.map(([name, cum]) => {
          const distFromStart = Math.round((cum - anchors.startCum) * 10) / 10;
          const properName = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          return `- ${properName} is at exactly ${distFromStart}km from ${location} (verified, source: Gronze.com / Brierley's guide)`;
        });
        finalPrompt += `\n\nVERIFIED DISTANCE ANCHORS from ${location} — these are real, sourced distances, treat them as ground truth and do not contradict them:
${lines.join('\n')}
For any smaller intermediate village between ${location} and these anchor points, interpolate proportionally based on these verified distances rather than guessing independently — this keeps your distance estimates calibrated to reality.`;
      }
    }

    // Try to fetch REAL weather data for the given location (free, no key needed)
    if (location) {
      try {
        const geoRes = await fetch(
          'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(location) + '&count=1'
        );
        const geoData = await geoRes.json();
        const place = geoData.results && geoData.results[0];

        if (place) {
          const wRes = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`
          );
          const wData = await wRes.json();

          if (wData.daily && wData.daily.temperature_2m_max) {
            const d = wData.daily;
            finalPrompt += `\n\nREAL CURRENT WEATHER DATA for ${location} (lat ${place.latitude}, lon ${place.longitude}) — use these EXACT numbers in your "weather" field, do NOT invent different numbers:
Today: high ${Math.round(d.temperature_2m_max[0])}°C, low ${Math.round(d.temperature_2m_min[0])}°C, ${d.precipitation_probability_max[0]}% chance of rain.
Tomorrow: high ${Math.round(d.temperature_2m_max[1])}°C, low ${Math.round(d.temperature_2m_min[1])}°C, ${d.precipitation_probability_max[1]}% chance of rain.`;
          }
        }
      } catch (weatherErr) {
        // If weather lookup fails for any reason, continue without it rather than blocking the whole plan
      }
    }

    const body = {
      model: 'claude-sonnet-4-6',
      max_tokens: 1800,
      messages: [{ role: 'user', content: finalPrompt }],
    };

    if (useSearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({ error: data.error?.message || 'Anthropic API error' });
      return;
    }

    const text = (data.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
