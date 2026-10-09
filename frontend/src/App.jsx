import { useCallback, useEffect, useState } from "react";

function localDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function emptySet() {
  return {
    reps: "",
    weight_kg: "",
    duration_seconds: "",
    distance_meters: "",
    rest_seconds: "90",
    is_warmup: false,
  };
}

function emptyExercise(exerciseId = "") {
  return { exercise_id: exerciseId, notes: "", sets: [emptySet()] };
}

async function requestJson(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}.`);
  }
  return payload;
}

function numberOrNull(value) {
  return value === "" ? null : Number(value);
}

function formatWorkoutDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function describeSet(set) {
  const details = [];
  if (set.reps !== null && set.reps !== undefined) {
    details.push(`${set.reps} reps`);
  }
  if (set.weight_kg !== null && set.weight_kg !== undefined) {
    details.push(`${set.weight_kg} kg`);
  }
  if (set.duration_seconds !== null && set.duration_seconds !== undefined) {
    details.push(`${set.duration_seconds}s`);
  }
  if (set.distance_meters !== null && set.distance_meters !== undefined) {
    details.push(`${set.distance_meters} m`);
  }
  if (set.is_warmup) {
    details.push("warm-up");
  }
  return details.join(" · ");
}

export default function App() {
  const [users, setUsers] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [workouts, setWorkouts] = useState([]);
  const [userId, setUserId] = useState("");
  const [startedAt, setStartedAt] = useState(() => localDateTimeValue(new Date()));
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [exerciseEntries, setExerciseEntries] = useState([emptyExercise()]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [userResult, exerciseResult, workoutResult] = await Promise.all([
        requestJson("/api/users"),
        requestJson("/api/exercises"),
        requestJson("/api/workouts?limit=100"),
      ]);
      setUsers(userResult.data);
      setExercises(exerciseResult.data);
      setWorkouts(workoutResult.data);
      setUserId((current) => current || String(userResult.data[0]?.id ?? ""));
      setExerciseEntries((entries) =>
        entries.map((entry) => ({
          ...entry,
          exercise_id: entry.exercise_id || String(exerciseResult.data[0]?.id ?? ""),
        })),
      );
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function updateExercise(exerciseIndex, key, value) {
    setExerciseEntries((entries) =>
      entries.map((entry, index) =>
        index === exerciseIndex ? { ...entry, [key]: value } : entry,
      ),
    );
  }

  function updateSet(exerciseIndex, setIndex, key, value) {
    setExerciseEntries((entries) =>
      entries.map((entry, index) =>
        index === exerciseIndex
          ? {
              ...entry,
              sets: entry.sets.map((set, currentSetIndex) =>
                currentSetIndex === setIndex ? { ...set, [key]: value } : set,
              ),
            }
          : entry,
      ),
    );
  }

  function buildWorkoutPayload() {
    if (!userId) {
      throw new Error("Add a user before creating a workout.");
    }
    if (!startedAt || !Number.isFinite(Date.parse(startedAt))) {
      throw new Error("Enter a valid workout date and time.");
    }
    if (exerciseEntries.length === 0) {
      throw new Error("Add at least one exercise.");
    }

    return {
      user_id: Number(userId),
      started_at: new Date(startedAt).toISOString(),
      title: title.trim() || null,
      notes: notes.trim() || null,
      exercises: exerciseEntries.map((entry, exerciseIndex) => {
        if (!entry.exercise_id) {
          throw new Error(`Choose an exercise for item ${exerciseIndex + 1}.`);
        }
        if (entry.sets.length === 0) {
          throw new Error(`Add at least one set for item ${exerciseIndex + 1}.`);
        }

        return {
          exercise_id: Number(entry.exercise_id),
          position: exerciseIndex + 1,
          notes: entry.notes.trim() || null,
          sets: entry.sets.map((set, setIndex) => {
            const measurements = {
              reps: numberOrNull(set.reps),
              weight_kg: numberOrNull(set.weight_kg),
              duration_seconds: numberOrNull(set.duration_seconds),
              distance_meters: numberOrNull(set.distance_meters),
            };
            if (Object.values(measurements).every((value) => value === null)) {
              throw new Error(
                `Set ${setIndex + 1} for item ${exerciseIndex + 1} needs reps, weight, duration, or distance.`,
              );
            }

            return {
              set_number: setIndex + 1,
              ...measurements,
              is_warmup: set.is_warmup,
              rest_seconds: numberOrNull(set.rest_seconds),
            };
          }),
        };
      }),
    };
  }

  async function submitWorkout(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    let workout;
    try {
      workout = buildWorkoutPayload();
    } catch (validationError) {
      setError(validationError.message);
      return;
    }

    setSubmitting(true);
    try {
      await requestJson("/api/workouts", {
        method: "POST",
        body: JSON.stringify(workout),
      });
      setNotice("Workout saved.");
      setStartedAt(localDateTimeValue(new Date()));
      setTitle("");
      setNotes("");
      setExerciseEntries([emptyExercise(String(exercises[0]?.id ?? ""))]);
      await loadData();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  const userNames = new Map(users.map((user) => [String(user.id), user.display_name]));

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="RepLog home">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span>RepLog</span>
        </a>
        <span className="topbar-note">Your training, in one place</span>
      </header>

      <section className="welcome">
        <p className="eyebrow">TRAINING LOG</p>
        <h1>Make every session count.</h1>
        <p>Capture the work. Come back stronger.</p>
      </section>

      {error && (
        <div className="message error-message" role="alert">
          <span>{error}</span>
          <button className="text-button" onClick={loadData} type="button">
            Retry
          </button>
        </div>
      )}
      {notice && <div className="message success-message" role="status">{notice}</div>}

      <div className="content-grid">
        <section className="panel form-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">NEW ENTRY</p>
              <h2>Log a workout</h2>
            </div>
            <span className="heading-icon" aria-hidden="true">＋</span>
          </div>

          <form onSubmit={submitWorkout}>
            <div className="form-grid">
              <label className="field">
                <span>Athlete</span>
                <select
                  required
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  disabled={loading || users.length === 0}
                >
                  {users.length === 0 && <option value="">No users available</option>}
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Date and time</span>
                <input
                  type="datetime-local"
                  value={startedAt}
                  onChange={(event) => setStartedAt(event.target.value)}
                  required
                />
              </label>
            </div>

            <label className="field">
              <span>Workout name <small>Optional</small></span>
              <input
                maxLength={160}
                placeholder="e.g. Full-body strength"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <div className="exercise-list">
              {exerciseEntries.map((entry, exerciseIndex) => (
                <fieldset className="exercise-card" key={exerciseIndex}>
                  <div className="exercise-card-heading">
                    <legend>Exercise {exerciseIndex + 1}</legend>
                    {exerciseEntries.length > 1 && (
                      <button
                        className="text-button remove-button"
                        onClick={() =>
                          setExerciseEntries((entries) =>
                            entries.filter((_, index) => index !== exerciseIndex),
                          )
                        }
                        type="button"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <label className="field">
                    <span>Movement</span>
                    <select
                      required
                      value={entry.exercise_id}
                      onChange={(event) =>
                        updateExercise(exerciseIndex, "exercise_id", event.target.value)
                      }
                      disabled={exercises.length === 0}
                    >
                      {exercises.length === 0 && (
                        <option value="">No exercises available</option>
                      )}
                      {exercises.map((exercise) => (
                        <option key={exercise.id} value={exercise.id}>
                          {exercise.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Exercise note <small>Optional</small></span>
                    <input
                      placeholder="Form cues, equipment, or variations"
                      value={entry.notes}
                      onChange={(event) =>
                        updateExercise(exerciseIndex, "notes", event.target.value)
                      }
                    />
                  </label>

                  <div className="sets-heading">
                    <span>Sets</span>
                    <span className="helper-copy">Add at least one measurement per set</span>
                  </div>

                  {entry.sets.map((set, setIndex) => (
                    <div className="set-row" key={setIndex}>
                      <span className="set-number">{String(setIndex + 1).padStart(2, "0")}</span>
                      <label className="compact-field">
                        <span>Reps</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          placeholder="—"
                          value={set.reps}
                          onChange={(event) =>
                            updateSet(exerciseIndex, setIndex, "reps", event.target.value)
                          }
                        />
                      </label>
                      <label className="compact-field">
                        <span>kg</span>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          inputMode="decimal"
                          placeholder="—"
                          value={set.weight_kg}
                          onChange={(event) =>
                            updateSet(exerciseIndex, setIndex, "weight_kg", event.target.value)
                          }
                        />
                      </label>
                      <label className="compact-field">
                        <span>Seconds</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          placeholder="—"
                          value={set.duration_seconds}
                          onChange={(event) =>
                            updateSet(
                              exerciseIndex,
                              setIndex,
                              "duration_seconds",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="compact-field">
                        <span>Distance m</span>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          inputMode="decimal"
                          placeholder="—"
                          value={set.distance_meters}
                          onChange={(event) =>
                            updateSet(
                              exerciseIndex,
                              setIndex,
                              "distance_meters",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="warmup-toggle">
                        <input
                          type="checkbox"
                          checked={set.is_warmup}
                          onChange={(event) =>
                            updateSet(exerciseIndex, setIndex, "is_warmup", event.target.checked)
                          }
                        />
                        <span>Warm-up</span>
                      </label>
                      {entry.sets.length > 1 && (
                        <button
                          className="icon-button delete-set"
                          aria-label={`Remove set ${setIndex + 1}`}
                          onClick={() =>
                            setExerciseEntries((entries) =>
                              entries.map((item, index) =>
                                index === exerciseIndex
                                  ? {
                                      ...item,
                                      sets: item.sets.filter(
                                        (_, currentSet) => currentSet !== setIndex,
                                      ),
                                    }
                                  : item,
                              ),
                            )
                          }
                          type="button"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}

                  <button
                    className="text-button add-set-button"
                    onClick={() =>
                      setExerciseEntries((entries) =>
                        entries.map((item, index) =>
                          index === exerciseIndex
                            ? { ...item, sets: [...item.sets, emptySet()] }
                            : item,
                        ),
                      )
                    }
                    type="button"
                  >
                    + Add set
                  </button>
                </fieldset>
              ))}
            </div>

            <button
              className="secondary-button add-exercise-button"
              onClick={() =>
                setExerciseEntries((entries) => [
                  ...entries,
                  emptyExercise(String(exercises[0]?.id ?? "")),
                ])
              }
              disabled={exercises.length === 0}
              type="button"
            >
              + Add another exercise
            </button>

            <label className="field notes-field">
              <span>Workout notes <small>Optional</small></span>
              <textarea
                maxLength={2000}
                placeholder="How did the session feel?"
                rows="3"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>

            <button
              className="primary-button submit-button"
              disabled={loading || submitting || users.length === 0 || exercises.length === 0}
              type="submit"
            >
              {submitting ? "Saving workout…" : "Save workout"}
              {!submitting && <span aria-hidden="true">→</span>}
            </button>
          </form>
        </section>

        <section className="workout-column">
          <div className="list-heading">
            <div>
              <p className="eyebrow">RECENT ACTIVITY</p>
              <h2>Your workouts</h2>
            </div>
            <span className="count-pill">{workouts.length}</span>
          </div>

          {loading ? (
            <div className="empty-state">Loading your workouts…</div>
          ) : workouts.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">◷</span>
              <h3>Nothing logged yet</h3>
              <p>Your workouts will show up here after you save one.</p>
            </div>
          ) : (
            <div className="workout-list">
              {workouts.map((workout) => (
                <article className="workout-card" key={workout.id}>
                  <div className="workout-card-top">
                    <div>
                      <p className="workout-date">{formatWorkoutDate(workout.started_at)}</p>
                      <h3>{workout.title || "Workout"}</h3>
                    </div>
                    <span className="athlete-pill">
                      {userNames.get(String(workout.user_id)) || `User ${workout.user_id}`}
                    </span>
                  </div>
                  {workout.notes && <p className="workout-notes">{workout.notes}</p>}
                  <div className="logged-exercises">
                    {workout.exercises.map((exercise) => (
                      <div className="logged-exercise" key={exercise.id}>
                        <div className="logged-exercise-title">
                          <span>{exercise.name}</span>
                          <span className="set-count">
                            {exercise.sets.length} {exercise.sets.length === 1 ? "set" : "sets"}
                          </span>
                        </div>
                        <ul>
                          {exercise.sets.map((set) => (
                            <li key={set.set_number}>
                              <span>Set {set.set_number}</span>
                              <span>{describeSet(set)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
