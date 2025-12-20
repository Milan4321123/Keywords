# Company Knowledge Base - Organizational AI

An AI-powered knowledge management system built around your company's keyword ontology. Define terms, create relationships, upload evidence, and get intelligent answers from your AI assistant.

## Features

### 🌳 Keyword Tree (Ontology)
- Hierarchical organization of company concepts
- Expandable/collapsible tree navigation
- Drag-and-drop reorganization (coming soon)

### 📝 Keyword Management
- **Definitions**: Short 1-2 line explanations
- **Explanations**: Detailed context (voice or typed)
- **Examples**: Real-world usage examples
- **Synonyms**: Alternative names, multilingual labels
- **Rules**: Business constraints and requirements

### 🎤 Voice Input
- Press the mic button and speak to add definitions
- Automatic transcription using OpenAI Whisper
- Works for definitions, explanations, and examples

### 🔗 Relationship Editor
- Connect keywords with semantic relations:
  - `is-a` (Invoice is-a Document)
  - `part-of` (Trade is part-of Project)
  - `requires` (Invoice requires Approval)
  - `depends-on` (Payment depends-on Approval)
  - And 10+ more relation types
- Visual relationship display
- Bidirectional relationship support

### 📎 Evidence Upload
- Upload PDFs, images, Excel, Word, and text files
- Automatic text extraction
- Link files to keywords as evidence
- Files are chunked and embedded for RAG

### 🤖 AI Assistant
- Ask questions in natural language
- Hybrid retrieval from:
  - Keyword definitions (structured knowledge)
  - Relationships (semantic connections)
  - Document chunks (evidence)
- Sources cited in responses
- Context-aware conversations

### Grounded Analytics (MVP)
- Upload Excel/CSV as structured tables (not just text chunks)
- Compute aggregations/trends via a query tool (not “LLM math”)
- Analytics chat that calls tools and returns row-level evidence (traceable IDs)
- UI at `/analytics`

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL + pgvector)
- **AI**: OpenAI GPT-4 + Whisper + Ada-002 Embeddings
- **Storage**: Supabase Storage

## Getting Started

### Prerequisites

- Node.js 18+
- Supabase account
- OpenAI API key

### Installation

1. **Clone and install dependencies**
   ```bash
   cd keywords
   npm install
   ```

2. **Set up Supabase**
   - Create a new Supabase project
   - Run the SQL schema from `supabase/schema.sql`
   - Enable the `pgvector` extension
   - Create a storage bucket named `assets`
   - If you created your project before analytics existed, run `supabase/analytics.sql` too

3. **Configure environment**
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local` with your credentials:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   OPENAI_API_KEY=sk-your-openai-key
   ```

4. **Run development server**
   ```bash
   npm run dev
   ```

5. **Open the app**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Database Schema

### Keywords Table
Stores your ontology nodes with definitions, examples, and metadata.

### Keyword Relations Table
Stores relationships between keywords (is-a, part-of, requires, etc.)

### Assets Table
Stores uploaded files with extracted text.

### Chunks Table
Stores document chunks with vector embeddings for RAG retrieval.

## Usage Guide

### Creating a Keyword
1. Click "+" in the sidebar or right-click → "Add sub-keyword"
2. Enter a title (e.g., "Invoice")
3. Add a short definition
4. Use the mic button to speak a detailed explanation
5. Add examples and rules
6. Save

### Adding Relations
1. Select a keyword
2. Go to the "Relations" tab
3. Click "Add Relation"
4. Choose relation type (e.g., "requires")
5. Select target keyword (e.g., "Approval")
6. Save

### Uploading Evidence
1. Select a keyword
2. Go to the "Files" tab
3. Drag & drop files or click to upload
4. Files are automatically processed and linked

### Asking Questions
1. Go to "Ask AI" tab
2. Optionally select context keywords
3. Type your question
4. AI responds using your knowledge base

## Example Domain Structure

```
Projects
├── Trade
│   ├── Electrical
│   ├── Plumbing
│   └── HVAC
├── Defect
│   ├── Major Defect
│   └── Minor Defect
└── Phase
    ├── Planning
    ├── Construction
    └── Completion

Documents
├── Invoice
│   └── requires → Approval
├── Contract
└── Approval
    └── owned-by → Bauleiter

Roles
├── Bauleiter (Site Manager)
├── Project Manager
└── Quality Inspector

Properties
├── Tenant
└── Unit
    └── part-of → Building
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/keywords` | GET | List all keywords |
| `/api/keywords` | POST | Create keyword |
| `/api/keywords/[id]` | GET | Get keyword with relations/assets |
| `/api/keywords/[id]` | PUT | Update keyword |
| `/api/keywords/[id]` | DELETE | Delete keyword |
| `/api/relations` | GET | List relations |
| `/api/relations` | POST | Create relation |
| `/api/relations` | DELETE | Delete relation |
| `/api/assets/upload` | POST | Upload file |
| `/api/assets/upload` | GET | List assets |
| `/api/transcribe` | POST | Transcribe audio |
| `/api/ask` | POST | Ask AI question |
| `/api/datasets` | GET | List datasets + tables |
| `/api/datasets/upload` | POST | Upload Excel/CSV as tables |
| `/api/analytics/query` | POST | Run aggregations with evidence |
| `/api/analytics/ask` | POST | Tool-grounded analytics chat |

## Roadmap

- [ ] Drag-and-drop tree reorganization
- [ ] Bulk import/export (CSV, JSON)
- [ ] Visual knowledge graph view
- [ ] User authentication & permissions
- [ ] Audit log / version history
- [ ] Workflow automation triggers
- [ ] Mobile app

## License

MIT
