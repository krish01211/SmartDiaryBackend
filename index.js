/**
 * Smart Diary — Emotion Classification + journal quotes (Ollama)
 *
 * Routes:
 *   GET  /health             → liveness
 *   POST /classify           → { emotion, confidence }
 *   POST /journal-insights   → { emotion, confidence, associative_quote, corrective_quote }
 */
const express = require('express')
const cors    = require('cors')
const http    = require('http')

const app  = express()
const PORT = 3007

app.use(cors())
app.use(express.json({ limit: '512kb' }))

const OLLAMA_MODEL  = 'gemma2:2b'
const EMOTION_LABELS = [
    'joy',
    'sadness',
    'anger',
    'fear',
    'disgust',
    'surprise',
    'neutral',
]

function buildPrompt(text) {
    return [
        'You are an emotion classifier. Read the following text and identify the PRIMARY emotion.',
        '',
        'VALID EMOTIONS (choose EXACTLY ONE):',
        'joy, sadness, anger, fear, disgust, surprise, neutral',
        '',
        'INSTRUCTIONS:',
        '1. Read the text carefully',
        '2. Identify the strongest emotion expressed',
        '3. Output ONLY the emotion word (lowercase, no punctuation)',
        '4. If multiple emotions are present, choose the most dominant one',
        '5. Only use "neutral" if NO clear emotion is expressed',
        '',
        `TEXT TO ANALYZE:`,
        `"""${text}"""`,
        '',
        'PRIMARY EMOTION:',
    ].join('\n')
}

function buildAssociativePrompt(text, emotion) {
    const excerpt = text.length > 4000 ? text.slice(0, 4000) + '…' : text
    return [
        'You are a warm, encouraging companion.',
        `The writer\'s strongest emotion: ${emotion}.`,
        '',
        'Write exactly ONE short sentence (max 40 words) that supports and validates them. ',
        'Acknowledge something concrete from what they wrote. Compliment their honesty or effort where fitting.',
        'No medical advice, no "therapy speak", no bullet points, no quote marks around the line.',
        '',
        'JOURNAL:',
        `"${excerpt.replace(/"/g, "'")}"`,
        '',
        'ONE SENTENCE:',
    ].join('\n')
}

function buildCorrectivePrompt(text, emotion) {
    const excerpt = text.length > 4000 ? text.slice(0, 4000) + '…' : text
    return [
        'You are a calm, rational coach — never harsh.',
        `The writer\'s strongest emotion: ${emotion}.`,
        '',
        'Write exactly ONE short sentence (max 40 words) that helps them think clearly about a constructive next step ',
        'or a balanced perspective. Encourage self-compassion. No blame, no diagnosing.',
        'No bullet points, no quote marks around the line.',
        '',
        'JOURNAL:',
        `"${excerpt.replace(/"/g, "'")}"`,
        '',
        'ONE SENTENCE:',
    ].join('\n')
}

function cleanQuoteLine(raw) {
    let s = String(raw ?? '').trim()
    s = s.replace(/^["']+|["']+$/g, '')
    s = s.split('\n').map(l => l.trim()).find(l => l.length > 0) || s
    s = s.replace(/^(ONE SENTENCE|ASSOCIATIVE|REFLECTIVE)[:\s]*/i, '')
    if (s.length > 500) s = s.slice(0, 497) + '…'
    return s || ''
}

function parseEmotion(responseText) {
    const cleaned = responseText.trim().toLowerCase().replace(/[^a-z]/g, '')

    if (EMOTION_LABELS.includes(cleaned)) {
        return { emotion: cleaned, confidence: 0.88 }
    }

    for (const label of EMOTION_LABELS) {
        if (cleaned.includes(label)) {
            return { emotion: label, confidence: 0.72 }
        }
    }

    console.warn(`[classify] Unparsed emotion from: "${responseText}" — neutral`)
    return { emotion: 'neutral', confidence: 0.5 }
}

function callOllama(prompt) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            model:  OLLAMA_MODEL,
            prompt,
            stream: false,
        })

        const options = {
            method:   'POST',
            hostname: 'localhost',
            port:     11435,
            path:     '/api/generate',
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        }

        const req = http.request(options, (res) => {
            let data = ''
            res.on('data', chunk => { data += chunk })
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    console.error(`[Ollama] HTTP ${res.statusCode}: ${data}`)
                    reject(new Error(`Ollama returned status ${res.statusCode}. Is Ollama running on port 11435?`))
                    return
                }
                try {
                    const parsed = JSON.parse(data)
                    resolve(parsed.response ?? '')
                } catch (err) {
                    reject(new Error(`Failed to parse Ollama response: ${err.message}`))
                }
            })
        })

        req.on('error', (err) => {
            reject(new Error(`Ollama connection failed: ${err.message}. Is Ollama running?`))
        })

        req.setTimeout(120000, () => {
            req.destroy()
            reject(new Error('Ollama request timed out.'))
        })

        req.write(body)
        req.end()
    })
}

app.get('/health', (req, res) => {
    res.json({ status: 'ok', model: OLLAMA_MODEL })
})

app.post('/classify', async (req, res) => {
    const { text } = req.body

    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid `text` field.' })
    }

    const trimmed = text.trim()
    if (trimmed.length === 0) {
        return res.json({ emotion: 'neutral', confidence: 1.0 })
    }

    try {
        const rawResponse = await callOllama(buildPrompt(trimmed))
        const result = parseEmotion(rawResponse)
        res.json(result)
    } catch (err) {
        console.error('[classify]', err.message)
        if (String(err.message).includes('Ollama')) {
            return res.status(503).json({ error: err.message, hint: 'Start Ollama with ollama serve' })
        }
        res.status(500).json({ error: err.message })
    }
})

/**
 * Full analysis: emotion + associative (supportive) + corrective (reflective) lines.
 */
app.post('/journal-insights', async (req, res) => {
    const { text } = req.body

    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid `text` field.' })
    }

    const trimmed = text.trim()
    if (trimmed.length === 0) {
        return res.json({
            emotion:            'neutral',
            confidence:         1.0,
            associative_quote:  'Showing up to write is already meaningful.',
            corrective_quote:   'Small, steady steps often beat perfect plans.',
        })
    }

    console.log(`[journal-insights] Analyzing ${trimmed.split(/\s+/).length} words…`)

    try {
        const rawEmotion = await callOllama(buildPrompt(trimmed))
        const { emotion, confidence } = parseEmotion(rawEmotion)

        const [rawAssoc, rawCorr] = await Promise.all([
            callOllama(buildAssociativePrompt(trimmed, emotion)),
            callOllama(buildCorrectivePrompt(trimmed, emotion)),
        ])

        let associative_quote = cleanQuoteLine(rawAssoc)
        let corrective_quote  = cleanQuoteLine(rawCorr)

        if (!associative_quote) {
            associative_quote = 'You gave your feelings space on the page — that takes courage.'
        }
        if (!corrective_quote) {
            corrective_quote = 'When you are ready, one small next step is enough.'
        }

        res.json({
            emotion,
            confidence,
            associative_quote,
            corrective_quote,
        })
    } catch (err) {
        console.error('[journal-insights]', err.message)
        if (String(err.message).includes('Ollama')) {
            return res.status(503).json({ error: err.message, hint: 'Start Ollama with ollama serve' })
        }
        res.status(500).json({ error: err.message })
    }
})

app.listen(PORT, () => {
    console.log(`[server] Smart Diary backend http://localhost:${PORT}`)
    console.log(`[server] Ollama model ${OLLAMA_MODEL} at localhost:11435`)
    console.log(`[server] GET /health | POST /classify | POST /journal-insights`)
})
