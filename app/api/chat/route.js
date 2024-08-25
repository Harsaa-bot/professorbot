// pages/api/gemini/chat.js

import { NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";
import google from 'google-generative-ai';

const systemPrompt = `You are an AI-powered assistant designed to help students find the best professors...`;

export async function POST(req) {
    const data = await req.json();

    // Initialize Pinecone
    const pc = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
    });

    const index = pc.index('rag').namespace('ns1');

    // Initialize Google Generative AI
    const genAI = new google.GenerativeAI({
        apiKey: process.env.GOOGLE_GENAI_API_KEY,
    });

    const text = data[data.length - 1].content;

    // Get embeddings using Gemini
    const embeddingResponse = await genAI.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float',
    });

    const embedding = embeddingResponse.data[0].embedding;

    // Query Pinecone index
    const results = await index.query({
        topK: 3,
        includeMetadata: true,
        vector: embedding,
    });

    let resultString = '\n\nReturned results from vector db:';
    results.matches.forEach((match) => {
        resultString += `\nProfessor: ${match.id}\nReview: ${match.metadata.stars}\nSubject: ${match.metadata.subject}\nStars: ${match.metadata.stars}\n\n`;
    });

    const lastMessage = data[data.length - 1];
    const lastMessageContent = lastMessage.content + resultString;
    const lastDataWithoutLastMessage = data.slice(0, data.length - 1);

    // Generate completion using Gemini
    const completion = await genAI.chat.completions.create({
        model: 'gpt-4',
        messages: [
            { role: 'system', content: systemPrompt },
            ...lastDataWithoutLastMessage,
            { role: 'user', content: lastMessageContent },
        ],
        stream: true,
    });

    // Stream response
    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            try {
                for await (const chunk of completion) {
                    const content = chunk.choices[0]?.delta?.content;
                    if (content) {
                        const text = encoder.encode(content);
                        controller.enqueue(text);
                    }
                }
            } catch (err) {
                controller.error(err);
            } finally {
                controller.close();
            }
        }
    });

    return new NextResponse(stream);
}
