require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Set it in backend/.env.");
  process.exit(1);
}

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = Number.parseInt(process.env.PORT || "3000", 10);

app.use(express.json({ limit: "1mb" }));

class RequestValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RequestValidationError(`${field} must be a positive integer.`);
  }
  return value;
}

function optionalNonnegativeNumber(value, field, { integer = false } = {}) {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new RequestValidationError(
      `${field} must be a nonnegative ${integer ? "integer" : "number"}.`,
    );
  }
  return value;
}

function optionalText(value, field) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new RequestValidationError(`${field} must be a string or null.`);
  }
  return value;
}

function optionalTimestamp(value, field) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new RequestValidationError(`${field} must be a valid date-time string.`);
  }
  return value;
}

function normalizeWorkout(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestValidationError("The request body must be a JSON object.");
  }

  const userId = positiveInteger(body.user_id, "user_id");
  const startedAt = optionalTimestamp(body.started_at, "started_at");
  const endedAt = optionalTimestamp(body.ended_at, "ended_at");
  const title = optionalText(body.title, "title");
  const notes = optionalText(body.notes, "notes");

  if (!Array.isArray(body.exercises) || body.exercises.length === 0) {
    throw new RequestValidationError("exercises must be a non-empty array.");
  }

  const positions = new Set();
  const exercises = body.exercises.map((exercise, exerciseIndex) => {
    if (!exercise || typeof exercise !== "object" || Array.isArray(exercise)) {
      throw new RequestValidationError(`exercises[${exerciseIndex}] must be an object.`);
    }

    const position = positiveInteger(
      exercise.position ?? exerciseIndex + 1,
      `exercises[${exerciseIndex}].position`,
    );
    if (positions.has(position)) {
      throw new RequestValidationError("Exercise positions must be unique.");
    }
    positions.add(position);

    if (!Array.isArray(exercise.sets) || exercise.sets.length === 0) {
      throw new RequestValidationError(
        `exercises[${exerciseIndex}].sets must be a non-empty array.`,
      );
    }

    const setNumbers = new Set();
    const sets = exercise.sets.map((set, setIndex) => {
      if (!set || typeof set !== "object" || Array.isArray(set)) {
        throw new RequestValidationError(
          `exercises[${exerciseIndex}].sets[${setIndex}] must be an object.`,
        );
      }

      const setNumber = positiveInteger(
        set.set_number ?? setIndex + 1,
        `exercises[${exerciseIndex}].sets[${setIndex}].set_number`,
      );
      if (setNumbers.has(setNumber)) {
        throw new RequestValidationError("Set numbers must be unique per exercise.");
      }
      setNumbers.add(setNumber);

      const normalizedSet = {
        set_number: setNumber,
        reps: optionalNonnegativeNumber(set.reps, "reps", { integer: true }),
        weight_kg: optionalNonnegativeNumber(set.weight_kg, "weight_kg"),
        duration_seconds: optionalNonnegativeNumber(set.duration_seconds, "duration_seconds", {
          integer: true,
        }),
        distance_meters: optionalNonnegativeNumber(set.distance_meters, "distance_meters"),
        is_warmup: set.is_warmup ?? false,
        rest_seconds: optionalNonnegativeNumber(set.rest_seconds, "rest_seconds", {
          integer: true,
        }),
      };

      if (typeof normalizedSet.is_warmup !== "boolean") {
        throw new RequestValidationError("is_warmup must be a boolean.");
      }
      if (
        normalizedSet.reps === null &&
        normalizedSet.weight_kg === null &&
        normalizedSet.duration_seconds === null &&
        normalizedSet.distance_meters === null
      ) {
        throw new RequestValidationError(
          "Each set must include reps, weight_kg, duration_seconds, or distance_meters.",
        );
      }

      return normalizedSet;
    });

    return {
      exercise_id: positiveInteger(
        exercise.exercise_id,
        `exercises[${exerciseIndex}].exercise_id`,
      ),
      position,
      notes: optionalText(exercise.notes, `exercises[${exerciseIndex}].notes`),
      sets,
    };
  });

  return { userId, startedAt, endedAt, title, notes, exercises };
}

function parseQueryInteger(value, fallback, field, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new RequestValidationError(`${field} must be a nonnegative integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new RequestValidationError(`${field} is out of range.`);
  }
  return parsed;
}

app.get("/api/users", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, email, display_name
       FROM users
       ORDER BY display_name, id`,
    );
    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get("/api/exercises", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, owner_user_id, name, description
       FROM exercises
       ORDER BY lower(name), id`,
    );
    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get("/api/workouts", async (req, res, next) => {
  try {
    const userId =
      req.query.user_id === undefined
        ? null
        : positiveInteger(
            parseQueryInteger(req.query.user_id, null, "user_id"),
            "user_id",
          );
    const limit = parseQueryInteger(req.query.limit, 50, "limit", 100);
    const offset = parseQueryInteger(req.query.offset, 0, "offset");

    const result = await pool.query(
      `WITH page AS (
         SELECT w.id, w.user_id, w.started_at, w.ended_at, w.title, w.notes,
                w.created_at, w.updated_at
         FROM workouts w
         WHERE $1::bigint IS NULL OR w.user_id = $1
         ORDER BY w.started_at DESC, w.id DESC
         LIMIT $2 OFFSET $3
       )
       SELECT p.id AS workout_id, p.user_id, p.started_at, p.ended_at,
              p.title, p.notes, p.created_at, p.updated_at,
              we.id AS workout_exercise_id, we.exercise_id,
              we.position, we.notes AS exercise_notes,
              e.name AS exercise_name, e.description AS exercise_description,
              s.set_number, s.reps, s.weight_kg, s.duration_seconds,
              s.distance_meters, s.is_warmup, s.rest_seconds
       FROM page p
       LEFT JOIN workout_exercises we ON we.workout_id = p.id
       LEFT JOIN exercises e ON e.id = we.exercise_id
       LEFT JOIN workout_sets s ON s.workout_exercise_id = we.id
       ORDER BY p.started_at DESC, p.id DESC, we.position, s.set_number`,
      [userId, limit, offset],
    );

    const workoutsById = new Map();
    for (const row of result.rows) {
      let workout = workoutsById.get(row.workout_id);
      if (!workout) {
        workout = {
          id: row.workout_id,
          user_id: row.user_id,
          started_at: row.started_at,
          ended_at: row.ended_at,
          title: row.title,
          notes: row.notes,
          created_at: row.created_at,
          updated_at: row.updated_at,
          exercises: [],
        };
        workoutsById.set(row.workout_id, workout);
      }

      if (row.workout_exercise_id === null) {
        continue;
      }

      let exercise = workout.exercises.at(-1);
      if (!exercise || exercise.id !== row.workout_exercise_id) {
        exercise = {
          id: row.workout_exercise_id,
          exercise_id: row.exercise_id,
          name: row.exercise_name,
          description: row.exercise_description,
          position: row.position,
          notes: row.exercise_notes,
          sets: [],
        };
        workout.exercises.push(exercise);
      }

      if (row.set_number !== null) {
        exercise.sets.push({
          set_number: row.set_number,
          reps: row.reps,
          weight_kg: row.weight_kg,
          duration_seconds: row.duration_seconds,
          distance_meters: row.distance_meters,
          is_warmup: row.is_warmup,
          rest_seconds: row.rest_seconds,
        });
      }
    }

    res.json({
      data: [...workoutsById.values()],
      pagination: { limit, offset },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/workouts", async (req, res, next) => {
  let client;
  let transactionStarted = false;

  try {
    const workoutInput = normalizeWorkout(req.body);
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const insertedWorkout = await client.query(
      `INSERT INTO workouts (user_id, started_at, ended_at, title, notes)
       VALUES ($1, COALESCE($2::timestamptz, now()), $3, $4, $5)
       RETURNING id, user_id, started_at, ended_at, title, notes, created_at, updated_at`,
      [
        workoutInput.userId,
        workoutInput.startedAt,
        workoutInput.endedAt,
        workoutInput.title,
        workoutInput.notes,
      ],
    );
    const workout = { ...insertedWorkout.rows[0], exercises: [] };

    for (const exerciseInput of workoutInput.exercises) {
      const insertedExercise = await client.query(
        `INSERT INTO workout_exercises (workout_id, exercise_id, position, notes)
         VALUES ($1, $2, $3, $4)
         RETURNING id, exercise_id, position, notes`,
        [workout.id, exerciseInput.exercise_id, exerciseInput.position, exerciseInput.notes],
      );
      const exercise = { ...insertedExercise.rows[0], sets: [] };

      for (const set of exerciseInput.sets) {
        const insertedSet = await client.query(
          `INSERT INTO workout_sets (
             workout_exercise_id, set_number, reps, weight_kg, duration_seconds,
             distance_meters, is_warmup, rest_seconds
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING set_number, reps, weight_kg, duration_seconds,
                     distance_meters, is_warmup, rest_seconds`,
          [
            exercise.id,
            set.set_number,
            set.reps,
            set.weight_kg,
            set.duration_seconds,
            set.distance_meters,
            set.is_warmup,
            set.rest_seconds,
          ],
        );
        exercise.sets.push(insertedSet.rows[0]);
      }

      workout.exercises.push(exercise);
    }

    await client.query("COMMIT");
    transactionStarted = false;
    res.status(201).json({ data: workout });
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Failed to roll back workout creation:", rollbackError);
      }
    }

    if (error.code === "23503") {
      error.status = 400;
      error.message = "The specified user or exercise does not exist.";
    } else if (error.code === "23505") {
      error.status = 400;
      error.message = "Exercise positions and set numbers must be unique.";
    } else if (error.code === "23514" || error.code === "22003") {
      error.status = 400;
      error.message = "A workout or set value violates a database constraint.";
    }
    next(error);
  } finally {
    client?.release();
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Request body must contain valid JSON." });
  }
  if (error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error("Request failed:", error);
  return res.status(500).json({ error: "Internal server error." });
});

async function shutdown() {
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.listen(port, () => {
  console.log(`Workout API listening on port ${port}`);
});
