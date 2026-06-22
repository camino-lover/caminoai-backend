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

// Full ordered list of named stops on the route, including small hamlets between
// the major verified towns above — mirrors the autocomplete list in the app.
const STAGES = [
  'Saint-Jean-Pied-de-Port','Orisson','Roncesvalles','Burguete','Espinal',
  'Zubiri','Larrasoaña','Pamplona','Cizur Menor','Zariquiegui',
  'Uterga','Muruzábal','Obanos','Puente la Reina','Mañeru','Cirauqui',
  'Lorca','Estella','Ayegui','Los Arcos','Sansol','Torres del Río','Viana',
  'Logroño','Navarrete','Nájera','Azofra','Santo Domingo de la Calzada',
  'Grañón','Redecilla del Camino','Belorado','Villafranca Montes de Oca',
  'San Juan de Ortega','Burgos','Tardajos','Hornillos del Camino','Hontanas',
  'Castrojeriz','Boadilla del Camino','Frómista','Carrión de los Condes',
  'Calzadilla de la Cueza','Terradillos de los Templarios','Sahagún',
  'Mansilla de las Mulas','León','Hospital de Órbigo','Astorga',
  'Rabanal del Camino','Foncebadón','Cruz de Ferro','El Acebo','Molinaseca',
  'Ponferrada','Villafranca del Bierzo','O Cebreiro','Triacastela','Samos',
  'Sarria','Portomarín','Palas de Rei','Melide','Arzúa','O Pedrouzo',
  'Monte do Gozo','Santiago de Compostela',
];

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Build a lookup of cumulative km at arrival for every MAJOR verified town
function buildCumulativeMap() {
  const map = { [normalize('Saint-Jean-Pied-de-Port')]: 0 };
  let cum = 0;
  for (const stage of STAGE_TABLE) {
    cum += stage.km;
    map[normalize(stage.to)] = cum;
  }
  return map;
}

// Walk the full STAGES list in order, assigning every name (major town OR small
// hamlet) to the verified segment it falls within. This lets us ground hamlets
// like Burguete even though they aren't in the verified major-town table.
function buildSegmentMap() {
  const map = {};
  let segIdx = 0;
  let fromCum = 0;
  for (const name of STAGES) {
    const norm = normalize(name);
    if (segIdx >= STAGE_TABLE.length) break;
    const seg = STAGE_TABLE[segIdx];
    const toCum = fromCum + seg.km;
    map[norm] = { fromTown: seg.from, toTown: seg.to, fromCum, toCum, isExactTown: norm === normalize(seg.to) };
    if (norm === normalize(seg.to)) {
      fromCum = toCum;
      segIdx++;
    }
  }
  return map;
}

// Find verified anchor points (real, sourced distances) near the given start location —
// works for both major towns AND small hamlets between them
function findAnchors(location) {
  const cumMap = buildCumulativeMap();
  const segMap = buildSegmentMap();
  const key = normalize(location);

  // Case 1: exact major verified town — we know its precise position
  if (cumMap[key] !== undefined) {
    const startCum = cumMap[key];
    const sorted = Object.entries(cumMap).sort((a, b) => a[1] - b[1]);
    const ahead = sorted.filter(([name, cum]) => cum > startCum).slice(0, 2);
    if (!ahead.length) return null;
    return {
      type: 'exact',
      lines: ahead.map(([name, cum]) => {
        const dist = Math.round((cum - startCum) * 10) / 10;
        const properName = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `- ${properName} is at exactly ${dist}km from ${location} (verified, source: Gronze.com / Brierley's guide)`;
      }),
    };
  }

  // Case 2: a small hamlet between two verified towns — bound it by the segment
  const seg = segMap[key];
  if (seg) {
    const segLen = Math.round((seg.toCum - seg.fromCum) * 10) / 10;
    const sorted = Object.entries(cumMap).sort((a, b) => a[1] - b[1]);
    const ahead = sorted.filter(([name, cum]) => cum > seg.toCum).slice(0, 1);
    const lines = [
      `- ${location} lies between the verified towns ${seg.fromTown} and ${seg.toTown}, which are exactly ${segLen}km apart (verified, source: Gronze.com / Brierley's guide). ${location} sits a short distance past ${seg.fromTown}, so the remaining distance to ${seg.toTown} is slightly less than ${segLen}km.`,
    ];
    if (ahead.length) {
      const [nextName, nextCum] = ahead[0];
      const nextDist = Math.round((nextCum - seg.toCum) * 10) / 10;
      const properNext = nextName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      lines.push(`- Beyond ${seg.toTown}, the next major verified town is ${properNext}, exactly ${nextDist}km further (verified).`);
    }
    return { type: 'bounded', lines };
  }

  return null; // not in our reference list at all — AI uses its own knowledge
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

    // Inject verified, sourced distance anchors — works for major towns and small hamlets alike
    if (location) {
      const anchors = findAnchors(location);
      if (anchors) {
        finalPrompt += `\n\nVERIFIED DISTANCE ANCHORS — these are real, sourced distances from gronze.com and Brierley's guide, treat them as ground truth and do not contradict them:
${anchors.lines.join('\n')}
Make sure every distance you state (in "recommended", "shorter", "longer", and "full_route") stays consistent with these verified checkpoints — your total km from ${location} to any town past these checkpoints must respect the verified distances above, even when estimating smaller intermediate villages.`;
      }
    }

    // Try to fetch REAL weather data for the given location (free, no key needed)
    if (location) {
      try {
        // Request multiple candidates so we can pick the right country —
        // tiny Camino villages can lose to bigger same-named places elsewhere
        // (e.g. there's also a "Roncesvalles" in Colombia with a much bigger population)
        const geoRes = await fetch(
          'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(location) + '&count=10'
        );
        const geoData = await geoRes.json();
        const results = geoData.results || [];
        const wantCountry = ['saint-jean-pied-de-port', 'orisson'].includes(normalize(location)) ? 'FR' : 'ES';
        const place = results.find(r => r.country_code === wantCountry) || results[0];

        if (place) {
          const wRes = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`
          );
          const wData = await wRes.json();

          if (wData.daily && wData.daily.temperature_2m_max) {
            const d = wData.daily;
            finalPrompt += `\n\nREAL CURRENT WEATHER DATA for ${location}, ${place.country || ''} (lat ${place.latitude}, lon ${place.longitude}) — use these EXACT numbers in your "weather" field, do NOT invent different numbers:
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
