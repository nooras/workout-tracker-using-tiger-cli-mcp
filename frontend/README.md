# RepLog frontend

React and Vite frontend for the workout tracker API.

## Run locally

1. Configure `DATABASE_URL` in `backend/.env` and start the API:

   ```sh
   cd backend
   npm install
   npm run dev
   ```

2. In another terminal, start the frontend:

   ```sh
   cd frontend
   npm install
   npm run dev
   ```

3. Open the local URL printed by Vite. The Vite dev server proxies `/api`
   requests to `http://localhost:3000`.

The frontend supports logging a workout with multiple exercises and sets,
viewing recent workouts, and showing the measurements captured for each set.
