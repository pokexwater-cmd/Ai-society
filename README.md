# AI Society Simulator

A tiny simulated world of AI-driven characters with distinct personalities, goals, memory, and relationships. Built step by step — this is Step 1: project skeleton + database connection.

## What this step does
- Runs a basic Express server
- Connects to a PostgreSQL database
- Exposes `/health` — confirms both the server and the database are alive
- Serves a simple status page at `/`

No game logic, no characters, no AI yet — just proving the foundation works.

## Setup

### 1. Push to GitHub
Same as before — create a repo, upload these files (or `git push`).

### 2. Create a Postgres database on Render
1. Go to your Render dashboard → **New +** → **PostgreSQL**
2. Name it anything (e.g. `ai-society-db`), free tier is fine
3. Once created, Render shows you an **Internal Database URL** and **External Database URL**

### 3. Deploy the web service
1. **New +** → **Web Service** → connect this repo
2. Build command: `npm install`
3. Start command: `npm start`
4. Under **Environment Variables**, add:
   - Key: `DATABASE_URL`
   - Value: paste the **Internal Database URL** from your Postgres dashboard (internal is faster and free between Render services)
5. Deploy

### 4. Test it
Visit your Render URL. It should say:
> ✅ Server and database are connected.

If it shows an error instead, double check the `DATABASE_URL` environment variable was pasted correctly.

## Next step
Once this is confirmed working, Step 2 adds the actual database tables (characters, relationships, memories, world events).
