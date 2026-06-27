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

    // Inject the FULL verified segment ahead — not just a few anchor points —
    // so the AI copies real waypoints instead of inventing its own each time.
    if (location) {
      const anchors = findAnchors(location);
      if (anchors) {
        finalPrompt += `\n\nVERIFIED ROUTE DATA from ${location} (source: Gronze.com's official stage-by-stage breakdown) — this is the COMPLETE real list of named stops ahead with exact distances:
${anchors.lines.join('\n')}

STRICT RULES — follow these exactly:
1. Choose "recommended", "shorter", and "longer" destinations from this verified list whenever a reasonable match exists for the target distance. If your chosen destination appears in this list, you MUST use its exact verified km value — never round, adjust, or approximate it.
2. For "full_route", list these verified waypoints in order with their EXACT km values. Do not invent additional stops, and never list the same physical place twice under a different spelling or alternate name (e.g. Bizkarreta and Viscarret are the same place — use only one).
3. Only add a name not on this list if you are highly confident it is real, it is not a duplicate of something already listed, and it does not contradict the verified distances around it.`;
      }
    }

    // Try to fetch REAL weather data for the given location (free, no key needed)
    if (location) {
      try {
        const geoRes = await fetch(
          'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(location) + '&count=10'
        );
        const geoData = await geoRes.json();
        const results = geoData.results || [];
        const wantCountry = ['saint-jean-pied-de-port', 'orisson', 'honto'].includes(normalize(location)) ? 'FR' : 'ES';

        // Country alone isn't enough — there's a second "Roncesvalles" in Madrid,
        // and likely other duplicate village names too. Prefer a match in one of
        // the real Camino Francés regions; only fall back to country-only if none found.
        const CAMINO_REGIONS = ['navarra', 'navarre', 'la rioja', 'castilla y leon', 'castilla y león', 'galicia', 'pais vasco', 'país vasco', 'aquitaine', 'nouvelle-aquitaine'];
        const countryMatches = results.filter(r => r.country_code === wantCountry);
        const place =
          countryMatches.find(r => CAMINO_REGIONS.includes(normalize(r.admin1 || ''))) ||
          countryMatches[0] ||
          results[0];

        if (place) {
          const wRes = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`
          );
          const wData = await wRes.json();

          if (wData.daily && wData.daily.temperature_2m_max) {
            const d = wData.daily;
            finalPrompt += `\n\nREAL CURRENT WEATHER DATA for ${location}, ${place.admin1 || ''} ${place.country || ''} (lat ${place.latitude}, lon ${place.longitude}) — use these EXACT numbers in your "weather" field, do NOT invent different numbers:
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

// ════════════════════════════════════════════════════════════════════════════
// VERIFIED ROUTE DATA — sourced directly from Gronze.com's official stage-by-
// stage "Recorrido" pages, fetched and cross-checked 2026-06-22. Each stage's
// intra-stage waypoints are stored as km-from-that-stage's-start; the code
// below converts everything into one continuous cumulative-from-Saint-Jean map.
// ════════════════════════════════════════════════════════════════════════════
const STAGE_TABLE = [
  { from: 'Saint-Jean-Pied-de-Port', to: 'Roncesvalles', km: 24.2, waypoints: [
    { name: 'Honto', km: 5.0 }, { name: 'Orisson', km: 7.6 },
    { name: 'Collado de Bentartea', km: 16.2 }, { name: 'Collado de Lepoeder', km: 20.2 },
  ]},
  { from: 'Roncesvalles', to: 'Zubiri', km: 21.4, waypoints: [
    { name: 'Burguete', km: 2.8 }, { name: 'Espinal', km: 6.5 },
    { name: 'Bizkarreta', km: 11.5 }, { name: 'Viscarret', km: 11.5 }, { name: 'Lintzoain', km: 13.4 },
    { name: 'Puerto de Erro', km: 17.9 }, { name: 'Alto de Erro', km: 17.9 },
  ]},
  { from: 'Zubiri', to: 'Pamplona', km: 20.4, waypoints: [
    { name: 'Ilarratz', km: 2.8 }, { name: 'Larrasoaña', km: 5.5 }, { name: 'Akerreta', km: 6.1 },
    { name: 'Zuriaín', km: 9.2 }, { name: 'Irotz', km: 11.3 }, { name: 'Trinidad de Arre', km: 16.0 },
    { name: 'Villava', km: 16.4 }, { name: 'Burlada', km: 17.5 },
  ]},
  { from: 'Pamplona', to: 'Puente la Reina', km: 23.9, waypoints: [
    { name: 'Cizur Menor', km: 4.9 }, { name: 'Zariquiegui', km: 11.0 }, { name: 'Alto del Perdón', km: 13.3 },
    { name: 'Uterga', km: 16.8 }, { name: 'Muruzábal', km: 19.5 }, { name: 'Obanos', km: 21.3 },
  ]},
  { from: 'Puente la Reina', to: 'Estella', km: 21.6, waypoints: [
    { name: 'Mañeru', km: 4.8 }, { name: 'Cirauqui', km: 7.5 }, { name: 'Lorca', km: 13.2 }, { name: 'Villatuerta', km: 17.8 },
  ]},
  { from: 'Estella', to: 'Los Arcos', km: 21.3, waypoints: [
    { name: 'Ayegui', km: 1.8 }, { name: 'Monasterio de Irache', km: 2.7 }, { name: 'Irache', km: 4.1 },
    { name: 'Ázqueta', km: 7.3 }, { name: 'Villamayor de Monjardín', km: 9.1 },
  ]},
  { from: 'Los Arcos', to: 'Logroño', km: 27.6, waypoints: [
    { name: 'Sansol', km: 6.8 }, { name: 'Torres del Río', km: 7.6 }, { name: 'Viana', km: 18.0 },
  ]},
  { from: 'Logroño', to: 'Nájera', km: 28.5, waypoints: [
    { name: 'Navarrete', km: 11.9 }, { name: 'Ventosa', km: 18.5 },
  ]},
  { from: 'Nájera', to: 'Santo Domingo de la Calzada', km: 20.7, waypoints: [
    { name: 'Azofra', km: 5.7 }, { name: 'Cirueña', km: 14.9 },
  ]},
  { from: 'Santo Domingo de la Calzada', to: 'Belorado', km: 22.0, waypoints: [
    { name: 'Grañón', km: 6.5 }, { name: 'Redecilla del Camino', km: 10.4 }, { name: 'Castildelgado', km: 12.0 },
    { name: 'Viloria de Rioja', km: 14.0 }, { name: 'Villamayor del Río', km: 17.4 },
  ]},
  { from: 'Belorado', to: 'San Juan de Ortega', km: 23.9, waypoints: [
    { name: 'Tosantos', km: 4.8 }, { name: 'Villambistia', km: 6.7 }, { name: 'Espinosa del Camino', km: 8.3 },
    { name: 'Villafranca Montes de Oca', km: 11.9 },
  ]},
  { from: 'San Juan de Ortega', to: 'Burgos', km: 25.8, waypoints: [
    { name: 'Agés', km: 3.6 }, { name: 'Atapuerca', km: 6.1 }, { name: 'Cardeñuela Riopico', km: 12.3 },
    { name: 'Orbaneja Riopico', km: 14.3 }, { name: 'Villafría', km: 17.9 },
  ]},
  { from: 'Burgos', to: 'Hornillos del Camino', km: 20.3, waypoints: [
    { name: 'Tardajos', km: 10.8 }, { name: 'Rabé de las Calzadas', km: 12.7 },
  ]},
  { from: 'Hornillos del Camino', to: 'Castrojeriz', km: 19.9, waypoints: [
    { name: 'San Bol', km: 5.7 }, { name: 'Hontanas', km: 10.5 }, { name: 'Convento de San Antón', km: 16.1 },
  ]},
  { from: 'Castrojeriz', to: 'Frómista', km: 24.7, waypoints: [
    { name: 'Ermita de San Nicolás de Puente Fitero', km: 9.0 }, { name: 'Itero de la Vega', km: 10.8 },
    { name: 'Boadilla del Camino', km: 19.0 },
  ]},
  { from: 'Frómista', to: 'Carrión de los Condes', km: 18.8, waypoints: [
    { name: 'Población de Campos', km: 3.4 }, { name: 'Revenga de Campos', km: 7.0 },
    { name: 'Villarmentero de Campos', km: 9.1 }, { name: 'Villalcázar de Sirga', km: 13.2 },
  ]},
  { from: 'Carrión de los Condes', to: 'Terradillos de los Templarios', km: 26.3, waypoints: [
    { name: 'Calzadilla de la Cueza', km: 17.2 }, { name: 'Ledigos', km: 23.4 },
  ]},
  { from: 'Terradillos de los Templarios', to: 'Bercianos del Real Camino', km: 23.2, waypoints: [
    { name: 'Moratinos', km: 3.4 }, { name: 'San Nicolás del Real Camino', km: 6.0 }, { name: 'Sahagún', km: 12.9 },
  ]},
  { from: 'Bercianos del Real Camino', to: 'Mansilla de las Mulas', km: 26.3, waypoints: [
    { name: 'El Burgo Ranero', km: 7.4 }, { name: 'Reliegos', km: 20.4 },
  ]},
  { from: 'Mansilla de las Mulas', to: 'León', km: 18.4, waypoints: [
    { name: 'Villamoros de Mansilla', km: 4.6 }, { name: 'Puente Villarente', km: 6.0 },
    { name: 'Arcahueja', km: 10.4 }, { name: 'Valdelafuente', km: 12.2 },
  ]},
  { from: 'León', to: 'San Martín del Camino', km: 24.6, waypoints: [
    { name: 'Trobajo del Camino', km: 3.8 }, { name: 'La Virgen del Camino', km: 7.1 },
    { name: 'Valverde de la Virgen', km: 11.4 }, { name: 'San Miguel del Camino', km: 12.9 },
    { name: 'Villadangos del Páramo', km: 20.4 },
  ]},
  { from: 'San Martín del Camino', to: 'Astorga', km: 23.7, waypoints: [
    { name: 'Puente de Órbigo', km: 6.8 }, { name: 'Hospital de Órbigo', km: 7.2 },
    { name: 'Villares de Órbigo', km: 9.8 }, { name: 'Santibáñez de Valdeiglesias', km: 12.2 },
    { name: 'San Justo de la Vega', km: 20.1 },
  ]},
  { from: 'Astorga', to: 'Foncebadón', km: 25.8, waypoints: [
    { name: 'Murias de Rechivaldo', km: 4.7 }, { name: 'Santa Catalina de Somoza', km: 9.2 },
    { name: 'El Ganso', km: 13.3 }, { name: 'Rabanal del Camino', km: 20.2 },
  ]},
  { from: 'Foncebadón', to: 'Ponferrada', km: 26.8, waypoints: [
    { name: 'Cruz de Ferro', km: 1.9 }, { name: 'Manjarín', km: 4.2 }, { name: 'El Acebo', km: 11.2 },
    { name: 'El Acebo de San Miguel', km: 11.2 }, { name: 'Riego de Ambrós', km: 14.5 },
    { name: 'Molinaseca', km: 19.1 }, { name: 'Campo', km: 23.5 },
  ]},
  { from: 'Ponferrada', to: 'Villafranca del Bierzo', km: 23.2, waypoints: [
    { name: 'Columbrianos', km: 4.9 }, { name: 'Fuentesnuevas', km: 7.3 }, { name: 'Camponaraya', km: 9.7 },
    { name: 'Cacabelos', km: 15.4 }, { name: 'Pieros', km: 17.5 },
  ]},
  { from: 'Villafranca del Bierzo', to: 'O Cebreiro', km: 27.8, waypoints: [
    { name: 'Pereje', km: 5.1 }, { name: 'Trabadelo', km: 9.6 }, { name: 'La Portela de Valcarce', km: 13.5 },
    { name: 'Ambasmestas', km: 14.6 }, { name: 'Vega de Valcarce', km: 16.3 }, { name: 'Ruitelán', km: 18.4 },
    { name: 'Las Herrerías', km: 19.7 }, { name: 'La Faba', km: 23.1 }, { name: 'Laguna de Castilla', km: 25.4 },
  ]},
  { from: 'O Cebreiro', to: 'Triacastela', km: 20.6, waypoints: [
    { name: 'Liñares', km: 3.1 }, { name: 'Hospital da Condesa', km: 5.5 }, { name: 'Padornelo', km: 7.9 },
    { name: 'Alto do Poio', km: 8.3 }, { name: 'Fonfría', km: 11.6 }, { name: 'O Biduedo', km: 14.1 },
    { name: 'Fillobal', km: 17.0 }, { name: 'Pasantes', km: 18.6 },
  ]},
  { from: 'Triacastela', to: 'Sarria', km: 17.8, via: 'San Xil variant', waypoints: [
    { name: 'A Balsa', km: 1.9 }, { name: 'San Xil', km: 3.7 }, { name: 'Montán', km: 6.7 },
    { name: 'Furela', km: 9.9 }, { name: 'Pintín', km: 11.1 }, { name: 'Calvor', km: 12.7 },
    { name: 'Aguiada', km: 13.3 }, { name: 'San Mamede do Camiño', km: 14.0 }, { name: 'Samos', km: 11.0 },
  ]},
  { from: 'Sarria', to: 'Portomarín', km: 22.2, waypoints: [
    { name: 'Barbadelo', km: 3.6 }, { name: 'Vilei', km: 3.6 }, { name: 'Rente', km: 5.2 }, { name: 'A Serra', km: 5.9 },
    { name: 'Molino de Marzán', km: 7.3 }, { name: 'Peruscallo', km: 9.1 }, { name: 'Morgade', km: 11.9 },
    { name: 'Ferreiros', km: 12.9 }, { name: 'Mirallos', km: 13.5 }, { name: 'As Rozas', km: 14.8 },
    { name: 'Mercadoiro', km: 16.9 }, { name: 'Vilachá', km: 19.8 },
  ]},
  { from: 'Portomarín', to: 'Palas de Rei', km: 24.8, waypoints: [
    { name: 'Toxibó', km: 4.7 }, { name: 'Gonzar', km: 7.9 }, { name: 'Castromaior', km: 9.2 },
    { name: 'Hospital da Cruz', km: 11.5 }, { name: 'Ventas de Narón', km: 13.0 }, { name: 'Ligonde', km: 16.2 },
    { name: 'Airexe', km: 17.1 }, { name: 'Portos', km: 19.2 }, { name: 'Lestedo', km: 19.8 },
  ]},
  { from: 'Palas de Rei', to: 'Arzúa', km: 28.5, waypoints: [
    { name: 'San Xulián do Camiño', km: 3.4 }, { name: 'Casanova', km: 5.6 }, { name: 'O Coto', km: 8.4 },
    { name: 'Leboreiro', km: 9.0 }, { name: 'Furelos', km: 13.0 }, { name: 'Melide', km: 14.4 },
    { name: 'Boente', km: 20.0 }, { name: 'Ribadiso de Baixo', km: 25.4 },
  ]},
  { from: 'Arzúa', to: 'O Pedrouzo', km: 19.3, waypoints: [
    { name: 'Pregontoño', km: 2.1 }, { name: 'A Salceda', km: 11.3 }, { name: 'Santa Irene', km: 15.9 },
  ]},
  { from: 'O Pedrouzo', to: 'Santiago de Compostela', km: 19.4, waypoints: [
    { name: 'Amenal', km: 3.3 }, { name: 'San Paio', km: 7.2 }, { name: 'Lavacolla', km: 9.5 },
    { name: 'Vilamaior', km: 10.8 }, { name: 'San Marcos', km: 14.5 }, { name: 'Monte do Gozo', km: 15.0 },
  ]},
];

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Build one flat cumulative-km-from-Saint-Jean map covering every verified
// town AND every verified intra-stage hamlet.
function buildCumulativeMap() {
  const map = { [normalize('Saint-Jean-Pied-de-Port')]: 0 };
  let cum = 0;
  for (const stage of STAGE_TABLE) {
    for (const wp of stage.waypoints || []) {
      const wpCum = cum + wp.km;
      const key = normalize(wp.name);
      if (map[key] === undefined) map[key] = wpCum; // first occurrence wins (handles alt-name duplicates)
    }
    cum += stage.km;
    map[normalize(stage.to)] = cum;
  }
  return map;
}

// Find the full verified route segment ahead of a location — covers almost
// every named stop, not just the 33 major towns. Alternate names for the same
// physical place (same exact km) are merged into one line to avoid the AI
// treating them as separate stops.
function findAnchors(location) {
  const cumMap = buildCumulativeMap();
  const key = normalize(location);
  const startCum = cumMap[key];

  if (startCum === undefined) return null; // genuinely not in our verified list — AI uses its own knowledge

  const sorted = Object.entries(cumMap).sort((a, b) => a[1] - b[1]);
  const ahead = sorted.filter(([name, cum]) => cum > startCum && cum <= startCum + 50);
  if (!ahead.length) return null;

  // Group alternate names that share the exact same verified distance
  const byDist = {};
  for (const [name, cum] of ahead) {
    const dist = Math.round((cum - startCum) * 10) / 10;
    const properName = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (!byDist[dist]) byDist[dist] = [];
    byDist[dist].push(properName);
  }

  const lines = Object.entries(byDist)
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
    .map(([dist, names]) => `${names.join(' / ')}: ${dist}km`);

  return { lines };
}
