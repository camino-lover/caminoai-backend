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
