# Phases feature removal

**Date:** 2026-04-21
**Decision:** Remove the "phases" (rehab progression timeline) feature entirely.

## What phases were

Curovate-style rehabilitation progression. A routine could define ordered
phases (e.g. "Foundation 3wk, Loading 4wk, Return 3wk"), each with a
duration in weeks. Setting `phase_start_date` on the routine activated
time-based progression: the server computed which phase was current, and
exercises assigned to a specific phase only appeared during that window.

## Why removed

Feature was built but not wanted. The user manages rehab routines without
time-gated phase logic; the extra UI (PhaseEditor, ExercisePhaseChip,
phase banner, phase start date field, phase group-by) added complexity
without value.

## What was removed

### Database

- `routine_phases` table (id, routine_id, label, order_idx, duration_weeks, notes)
- `routines.phase_start_date` column
- `routine_exercises.phase_id` column
- Migration `002_drop_phases.sql` drops these from PostgreSQL; SQLite
  schema was updated in `database.py` (no ALTER needed, table rebuilt).

### API endpoints removed

- `GET    /routines/{id}/phases`
- `POST   /routines/{id}/phases`
- `PUT    /routines/{id}/phases/{phase_id}`
- `DELETE /routines/{id}/phases/{phase_id}`
- `POST   /routines/{id}/phases/reorder`

### Backend files deleted

- `backend/tests/test_routine_phases.py` (503 lines, 100% phase tests)

### Backend files edited (phase code removed)

- `backend/app/models.py` -- PhaseCreate, PhaseUpdate, PhaseResponse,
  RoutineImportPhase classes; phase fields from RoutineUpdate,
  RoutineResponse, RoutineImportExercise, RoutineImportRequest
- `backend/app/hydrate.py` -- resolve_current_phase_id(), _parse_iso_date(),
  phases query block in hydrate_routines_full()
- `backend/app/database.py` -- routine_phases CREATE TABLE, phase columns
  in _ensure_columns()
- `backend/app/routes/routine_routes.py` -- 5 phase endpoints, phase
  cloning/import logic, phase_id from update allow-lists
- `backend/migrations/001_schema.sql` -- routine_phases table definition
- `backend/seed_workouts.py` -- "Hip/Ankle Rehab (Phased)" demo routine
- `backend/tests/test_routine_clone.py` -- 1 phase test
- `backend/tests/test_routes_routine_import.py` -- 3 phase tests

### Mobile files deleted

- `mobile/lib/phases.ts` (91 lines)
- `mobile/lib/phaseEditor.ts` (90 lines)
- `mobile/components/PhaseEditor.tsx` (346 lines)
- `mobile/components/ExercisePhaseChip.tsx` (173 lines)
- `mobile/__tests__/phases.test.ts` (~280 lines)
- `mobile/__tests__/phaseEditor.test.ts` (~200 lines)

### Mobile files edited (phase code removed)

- `mobile/app/workout/[routineId].tsx` -- Phase imports, phase banner,
  PhaseEditor, ExercisePhaseChip, phase_start_date state/field/save
- `mobile/lib/stores.ts` -- RoutinePhase interface, phase fields from Routine
- `mobile/lib/api.ts` -- Phase CRUD functions, phase fields from types
- `mobile/lib/routineImport.ts` -- phase_idx handling, phase remapping
- `mobile/lib/workoutGroupBy.ts` -- 'phase' group-by option
- `mobile/app/workout/session/[id].tsx` -- current_phase_id / phase filtering
- `mobile/app/(tabs)/workouts.tsx` -- phase group-by option
- `mobile/components/RoutineImportCard.tsx` -- phase example data
- `mobile/__tests__/routineImport.test.ts` -- phase test cases
- `mobile/__tests__/workoutGroupBy.test.ts` -- phase test cases

## Estimated lines removed

~2,500 lines across backend + mobile (code + tests).
