# Workout tracker API

Express API backed by the workout-tracker PostgreSQL schema. It expects that the
`users`, `exercises`, `workouts`, `workout_exercises`, and `workout_sets` tables
have already been created.

## Setup

```sh
cd backend
npm install
cp .env.example .env
```

Set `DATABASE_URL` in `.env` to the PostgreSQL connection string for the Tiger
service. For Tiger connection strings using `sslmode=require`, include
`uselibpqcompat=true` so `node-postgres` preserves PostgreSQL/libpq's encrypted
connection behavior instead of applying its stricter certificate-verification
interpretation. This encrypts traffic but does not verify the server certificate;
use a trusted CA and `sslmode=verify-full` where certificate verification is
required. Keep credentials out of source control; `.env` is ignored by Git.
`PORT` defaults to `3000`.

Start the API with `npm start`, or use `npm run dev` with Node.js 20 or newer.

## Endpoints

### `GET /api/users`

Lists users with their IDs, names, and email addresses for workout forms.

### `GET /api/exercises`

Lists the available shared and user-owned exercises.

### `GET /api/workouts`

Lists workouts, including exercises and sets, newest first. Query parameters:

- `user_id` (optional): filter by user ID.
- `limit` (optional, default `50`, maximum `100`): page size.
- `offset` (optional, default `0`): number of workouts to skip.

### `POST /api/workouts`

Creates a workout and its exercises and sets atomically. The database validates
that the user and exercises exist. Exercise `position` and set `set_number`
default to their one-based array positions.

Example body:

```json
{
  "user_id": 1,
  "title": "Strength session",
  "started_at": "2026-10-09T18:00:00Z",
  "ended_at": "2026-10-09T19:00:00Z",
  "exercises": [
    {
      "exercise_id": 1,
      "sets": [
        { "reps": 8, "weight_kg": 45, "is_warmup": false, "rest_seconds": 90 },
        { "reps": 8, "weight_kg": 50 }
      ]
    }
  ]
}
```

Each exercise must include at least one set. Each set must include at least one
of `reps`, `weight_kg`, `duration_seconds`, or `distance_meters`. The API uses
parameterized SQL and returns validation and foreign-key errors as HTTP 400.
