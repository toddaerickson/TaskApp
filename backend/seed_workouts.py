"""
Seed the workout module with global exercises + (optionally) an "Ankle Mobility AM"
routine for a specific user.

Run modes (in order of precedence when `seed_data/exercise_snapshot.json` exists):
  1. Snapshot-driven: globals are upserted from the JSON snapshot (the
     canonical source once adopted). Image lists are replaced wholesale
     so curation changes roll out.
  2. Hardcoded defaults (the `EXERCISES` list + `IMAGES` dict below): used
     only when no snapshot file is present — the fresh-bootstrap path for
     a brand-new environment.

Usage:
    python seed_workouts.py                    # seed global exercises only
    python seed_workouts.py user@example.com   # also create the ankle routine for that user
    python seed_workouts.py --resync-images    # re-apply the hardcoded IMAGES dict
"""
import json
import sys
from pathlib import Path

from app.database import get_db, init_db

ROOT = Path(__file__).resolve().parent
SNAPSHOT_PATH = ROOT / "seed_data" / "exercise_snapshot.json"


# Image URLs from wger (CC-BY-SA, https://wger.de). Substitute your own later.
# Verified image URLs from yuhonas/free-exercise-db (MIT license).
# Base: https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/
_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises"
IMAGES = {
    "wall_ankle_dorsiflexion": [
        f"{_BASE}/Calf_Stretch_Hands_Against_Wall/0.jpg",
        f"{_BASE}/Calf_Stretch_Hands_Against_Wall/1.jpg",
    ],
    "eccentric_calf_raise_straight": [
        f"{_BASE}/Calf_Raise_On_A_Dumbbell/0.jpg",
        f"{_BASE}/Calf_Raise_On_A_Dumbbell/1.jpg",
    ],
    "eccentric_calf_raise_bent": [
        f"{_BASE}/Dumbbell_Seated_One-Leg_Calf_Raise/0.jpg",
        f"{_BASE}/Dumbbell_Seated_One-Leg_Calf_Raise/1.jpg",
    ],
    "plantar_fascia_roll": [
        f"{_BASE}/Foot-SMR/0.jpg",
        f"{_BASE}/Foot-SMR/1.jpg",
    ],
    "half_kneeling_hip_flexor": [
        f"{_BASE}/Kneeling_Hip_Flexor/0.jpg",
        f"{_BASE}/Intermediate_Hip_Flexor_and_Quad_Stretch/0.jpg",
    ],
    "single_leg_glute_bridge": [
        f"{_BASE}/Barbell_Glute_Bridge/0.jpg",
        f"{_BASE}/Hip_Lift_with_Band/0.jpg",
    ],
    "banded_lateral_walk": [
        f"{_BASE}/Monster_Walk/0.jpg",
        f"{_BASE}/Monster_Walk/1.jpg",
    ],
    "banded_ankle_mobilization": [
        f"{_BASE}/Ankle_Circles/0.jpg",
    ],
    "banded_glute_bridge": [
        f"{_BASE}/Hip_Lift_with_Band/0.jpg",
        f"{_BASE}/Hip_Extension_with_Bands/0.jpg",
    ],
    "single_leg_rdl": [
        f"{_BASE}/Kettlebell_One-Legged_Deadlift/0.jpg",
        f"{_BASE}/Kettlebell_One-Legged_Deadlift/1.jpg",
    ],
    "figure_4_stretch": [
        f"{_BASE}/Ankle_On_The_Knee/0.jpg",
    ],
    # Wikimedia Commons matches for exercises missing from free-exercise-db.
    "side_lying_hip_abduction": [
        "https://upload.wikimedia.org/wikipedia/commons/5/54/Side_Leg_Raise.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/f/f7/Side-reclining_leg_lift_pose.jpg",
    ],
    "isometric_seated_external_rotation": [
        "https://upload.wikimedia.org/wikipedia/commons/7/7a/Piriformis_stretch.jpg",
    ],
    # Still needing images — use the Admin screen's "Search" button:
    # clamshell_banded, seated_soleus_stretch, banded_fire_hydrant
}


EXERCISES = [
    {
        "slug": "wall_ankle_dorsiflexion",
        "name": "Wall Ankle Dorsiflexion Stretch",
        "category": "mobility",
        "primary_muscle": "gastrocnemius/soleus",
        "equipment": "wall",
        "difficulty": 1,
        "is_bodyweight": True,
        "measurement": "duration",
        "instructions": (
            "Face a wall in a half-kneeling position. Place the front foot a few "
            "inches from the wall. Drive the front knee forward over the toes, "
            "keeping the heel flat on the floor. Hold."
        ),
        "cue": "Knee tracks straight over the toes; heel never lifts.",
        "images": [
            "https://wger.de/media/exercise-images/91/Calf-stretch-1.png",
        ],
    },
    {
        "slug": "eccentric_calf_raise_straight",
        "name": "Eccentric Calf Raise (Straight Knee)",
        "category": "rehab",
        "primary_muscle": "gastrocnemius",
        "equipment": "step",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Stand on a step with heels hanging off. Rise onto both toes, shift "
            "weight to the working leg, then lower the heel below the step over "
            "3 seconds. Use the other leg to return to the top."
        ),
        "cue": "3-second descent. Don't bounce at the bottom.",
        "images": [
            "https://wger.de/media/exercise-images/102/Standing-calf-raises-1.png",
        ],
    },
    {
        "slug": "eccentric_calf_raise_bent",
        "name": "Eccentric Calf Raise (Bent Knee)",
        "category": "rehab",
        "primary_muscle": "soleus",
        "equipment": "step",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Same setup as straight-knee version, but maintain a 20-30 degree "
            "knee bend throughout. Targets the soleus."
        ),
        "cue": "Knee bend stays consistent top to bottom.",
        "images": [
            "https://wger.de/media/exercise-images/102/Standing-calf-raises-2.png",
        ],
    },
    {
        "slug": "plantar_fascia_roll",
        "name": "Plantar Fascia Roll",
        "category": "mobility",
        "primary_muscle": "plantar fascia",
        "equipment": "lacrosse ball or frozen bottle",
        "difficulty": 1,
        "is_bodyweight": True,
        "measurement": "duration",
        "instructions": (
            "Seated or standing, roll the sole of the foot over a lacrosse ball "
            "or frozen water bottle. Pause on tender spots for 10-15 seconds."
        ),
        "cue": "Pressure should be uncomfortable, not sharp.",
        "images": [],
    },
    {
        "slug": "half_kneeling_hip_flexor",
        "name": "Half-Kneeling Hip Flexor Stretch",
        "category": "stretch",
        "primary_muscle": "hip flexors / psoas",
        "equipment": "none",
        "difficulty": 1,
        "is_bodyweight": True,
        "measurement": "duration",
        "instructions": (
            "Half-kneeling: one knee on the ground, other foot forward at 90°. "
            "Squeeze the glute on the kneeling side, then shift hips forward. "
            "Stretch is felt at the front of the kneeling-side hip."
        ),
        "cue": "Glute squeeze BEFORE the shift — passive stretch alone is weaker.",
        "images": [
            "https://wger.de/media/exercise-images/126/Hip-flexor-stretch-1.png",
        ],
    },
    {
        "slug": "clamshell_banded",
        "name": "Side-Lying Clamshells (Banded)",
        "category": "strength",
        "primary_muscle": "glute med",
        "equipment": "mini band",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Lie on side with band just above knees, feet stacked, knees bent ~45°. "
            "Keep pelvis still and feet together as you open the top knee. Tempo: "
            "2s up, 2s hold, 3s down."
        ),
        "cue": "Pelvis does NOT roll back. If felt in front of hip, reduce range.",
        "images": [
            "https://wger.de/media/exercise-images/311/Clam-shell-1.png",
        ],
    },
    {
        "slug": "banded_lateral_walk",
        "name": "Banded Lateral Walks",
        "category": "strength",
        "primary_muscle": "glute med",
        "equipment": "mini band",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Band above knees (or above ankles for harder). Quarter squat. "
            "Step sideways keeping tension on the band. Toes forward, not splayed."
        ),
        "cue": "Stay low; don't bob up and down. Tension on the band at all times.",
        "images": [],
    },
    {
        "slug": "side_lying_hip_abduction",
        "name": "Side-Lying Hip Abduction",
        "category": "strength",
        "primary_muscle": "glute med",
        "equipment": "none",
        "difficulty": 1,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Lie on one side, bottom leg bent for stability. Lift the top leg "
            "straight up with toe pointed slightly toward the ceiling. Lower under control."
        ),
        "cue": "Toe rotates up (not down). Lift ~30-45°, not higher.",
        "images": [],
    },
    {
        "slug": "banded_ankle_mobilization",
        "name": "Banded Ankle Mobilization",
        "category": "mobility",
        "primary_muscle": "anterior tibialis / joint capsule",
        "equipment": "resistance band anchor",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "duration",
        "instructions": (
            "Anchor a band behind you, loop it low on the front of the ankle "
            "(just above the joint line). Half-kneeling with that foot forward. "
            "Drive the knee forward over the toes. The band pulls the talus back, "
            "opening the joint."
        ),
        "cue": "Band pulls the ankle back as the knee drives forward. Heel stays down.",
        "images": [],
    },
    {
        "slug": "seated_soleus_stretch",
        "name": "Seated Soleus Stretch",
        "category": "stretch",
        "primary_muscle": "soleus",
        "equipment": "chair",
        "difficulty": 1,
        "is_bodyweight": True,
        "measurement": "duration",
        "instructions": (
            "Seated in a chair, foot flat. Lean forward, pressing the knee out "
            "over the toes while keeping the heel planted. Stretch is felt deep "
            "in the lower calf."
        ),
        "cue": "Heel down, knee tracks over toes. Mild-to-moderate stretch, not painful.",
        "images": [],
    },
    {
        "slug": "isometric_seated_external_rotation",
        "name": "Isometric Seated External Rotation",
        "category": "rehab",
        "primary_muscle": "piriformis / deep hip rotators",
        "equipment": "chair",
        "difficulty": 1,
        "is_bodyweight": True,
        "measurement": "duration",
        "instructions": (
            "Seated with knee bent 90°. Cross the ankle over the opposite thigh. "
            "Press the ankle gently upward into your hand (isometric). Hold and "
            "feel the deep glute engage."
        ),
        "cue": "No joint movement — just tension. Feel the deep-glute contraction.",
        "images": [],
    },
    {
        "slug": "banded_fire_hydrant",
        "name": "Banded Fire Hydrants",
        "category": "strength",
        "primary_muscle": "glute med / external rotators",
        "equipment": "mini band",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "On all fours, band above knees. Lift one bent knee out to the side "
            "(like a dog at a fire hydrant). Keep back flat, pelvis square."
        ),
        "cue": "Hips stay level; don't rotate. Band tension throughout.",
        "images": [],
    },
    {
        "slug": "banded_glute_bridge",
        "name": "Banded Glute Bridge",
        "category": "strength",
        "primary_muscle": "glute max + glute med",
        "equipment": "mini band",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Lie on back, mini-band above knees, feet flat. Drive through heels "
            "to lift hips AND push knees out against the band simultaneously. "
            "Integrates extension with external rotation."
        ),
        "cue": "Push knees OUT as you drive up. Squeeze at the top, ribs down.",
        "images": [],
    },
    {
        "slug": "single_leg_rdl",
        "name": "Single-Leg Romanian Deadlift",
        "category": "strength",
        "primary_muscle": "glute max / hamstring",
        "equipment": "none (or light dumbbell)",
        "difficulty": 3,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Stand on one leg, soft knee. Hinge at the hips, back flat, trailing "
            "leg extends behind you. Drive through the heel to stand, squeezing "
            "the glute at the top."
        ),
        "cue": "Standing knee tracks over the 2nd toe — NO valgus collapse.",
        "images": [],
    },
    {
        "slug": "figure_4_stretch",
        "name": "Figure-4 Stretch (Reclining Pigeon)",
        "category": "stretch",
        "primary_muscle": "piriformis / deep rotators",
        "equipment": "none",
        "difficulty": 1,
        "is_bodyweight": True,
        "measurement": "duration",
        "instructions": (
            "Lie on back. Cross one ankle over the opposite knee (figure-4 shape). "
            "Grab the back of the supporting thigh and pull toward your chest. "
            "Stretch is felt in the outer hip / glute of the crossed leg."
        ),
        "cue": "Keep shoulders flat on the floor. Gentle, long hold.",
        "images": [],
    },
    {
        "slug": "single_leg_glute_bridge",
        "name": "Single-Leg Glute Bridge",
        "category": "strength",
        "primary_muscle": "glute max",
        "equipment": "none",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Lie on back, one foot flat on floor, other leg extended or held at "
            "chest. Drive through the planted heel to lift hips. Hold 1 sec at top, "
            "lower under control."
        ),
        "cue": "Squeeze glute hard at the top; ribs stay down.",
        "images": [
            "https://wger.de/media/exercise-images/130/Glute-bridge-1.png",
        ],
    },
    # ---------- Compound strength / calisthenics fundamentals ----------
    # Added in PR 7. These cover the big movement patterns the user
    # would otherwise have to hand-create: squat, hinge, push, pull,
    # row, single-leg, plank. All bodyweight-by-default with an
    # optional loaded variant implied by `measurement=reps_weight`;
    # routines that want the loaded version just fill target_weight.
    {
        "slug": "squat",
        "name": "Squat",
        "category": "strength",
        "primary_muscle": "quadriceps / glutes",
        "equipment": "none (or barbell / goblet)",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "reps_weight",
        "instructions": (
            "Feet shoulder-width, toes slightly out. Brace core, sit hips "
            "back and down until thighs are parallel (or to comfortable "
            "depth). Drive through midfoot to stand. Keep torso upright."
        ),
        "cue": "Knees track over toes; chest stays proud.",
        "images": [
            f"{_BASE}/Barbell_Squat/0.jpg",
            f"{_BASE}/Barbell_Squat/1.jpg",
        ],
    },
    {
        "slug": "pushup",
        "name": "Push-up",
        "category": "strength",
        "primary_muscle": "chest / triceps",
        "equipment": "none",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Start in a high plank, hands just wider than shoulders. "
            "Keep a straight line from head to heels. Lower until chest "
            "hovers above the floor, then press back up."
        ),
        "cue": "Elbows ~45° from the torso; core stays braced.",
        "images": [
            f"{_BASE}/Pushups/0.jpg",
            f"{_BASE}/Pushups/1.jpg",
        ],
    },
    {
        "slug": "pullup",
        "name": "Pull-up",
        "category": "strength",
        "primary_muscle": "lats / upper back",
        "equipment": "pull-up bar",
        "difficulty": 4,
        "is_bodyweight": True,
        "measurement": "reps_weight",
        "instructions": (
            "Hang from the bar with an overhand grip slightly wider than "
            "shoulders. Pull chest to the bar, leading with the elbows. "
            "Lower under control to a dead hang."
        ),
        "cue": "Shoulders pack down before the pull; don't swing.",
        "images": [
            f"{_BASE}/Pullups/0.jpg",
            f"{_BASE}/Pullups/1.jpg",
        ],
    },
    {
        "slug": "deadlift",
        "name": "Deadlift",
        "category": "strength",
        "primary_muscle": "posterior chain",
        "equipment": "barbell",
        "difficulty": 3,
        "is_bodyweight": False,
        "measurement": "reps_weight",
        "instructions": (
            "Feet hip-width under the bar. Hinge, grip bar just outside "
            "shins. Set a flat back and wedge tension before the pull. "
            "Drive the floor away; bar travels straight up the shins."
        ),
        "cue": "Pull the slack out of the bar before you lift it.",
        "images": [
            f"{_BASE}/Barbell_Deadlift/0.jpg",
            f"{_BASE}/Barbell_Deadlift/1.jpg",
        ],
    },
    {
        "slug": "row",
        "name": "Bent-Over Row",
        "category": "strength",
        "primary_muscle": "mid-back / lats",
        "equipment": "barbell or dumbbells",
        "difficulty": 2,
        "is_bodyweight": False,
        "measurement": "reps_weight",
        "instructions": (
            "Hinge forward with a flat back, knees soft. Row the bar "
            "(or dumbbells) to the lower ribs, leading with the elbows. "
            "Pause, then lower under control."
        ),
        "cue": "Squeeze the shoulder blades; hips stay back.",
        "images": [
            f"{_BASE}/Bent_Over_Barbell_Row/0.jpg",
            f"{_BASE}/Bent_Over_Barbell_Row/1.jpg",
        ],
    },
    {
        "slug": "lunge",
        "name": "Lunge",
        "category": "strength",
        "primary_muscle": "quadriceps / glutes",
        "equipment": "none (or dumbbells)",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Step forward into a long stride. Lower the back knee toward "
            "the floor; front shin stays vertical. Drive through the "
            "front heel to return. Alternate legs or finish one side."
        ),
        "cue": "Torso upright; back knee kisses, doesn't crash.",
        "images": [
            f"{_BASE}/Bodyweight_Walking_Lunge/0.jpg",
            f"{_BASE}/Bodyweight_Walking_Lunge/1.jpg",
        ],
    },
    {
        "slug": "plank",
        "name": "Plank",
        "category": "strength",
        "primary_muscle": "core",
        "equipment": "none",
        "difficulty": 1,
        "is_bodyweight": True,
        "measurement": "duration",
        "instructions": (
            "Forearms on the floor under the shoulders, feet hip-width, "
            "body in a straight line from head to heels. Brace the core, "
            "squeeze the glutes, breathe steadily. Hold for time."
        ),
        "cue": "Don't let hips sag or pike; ribs stay down.",
        "images": [
            f"{_BASE}/Plank/0.jpg",
        ],
    },
    {
        "slug": "bench_press",
        "name": "Bench Press",
        "category": "strength",
        "primary_muscle": "chest / triceps / front delts",
        "equipment": "barbell + bench",
        "difficulty": 3,
        "is_bodyweight": False,
        "measurement": "reps_weight",
        "instructions": (
            "Lie back on a flat bench, eyes under the bar. Grip just wider "
            "than shoulder-width, wrists stacked over elbows. Unrack, "
            "settle over the mid-chest. Lower under control to touch the "
            "lower chest, then press the bar back up and slightly back."
        ),
        "cue": "Shoulder blades pinned; feet drive through the floor.",
        "images": [
            f"{_BASE}/Barbell_Bench_Press_-_Medium_Grip/0.jpg",
            f"{_BASE}/Barbell_Bench_Press_-_Medium_Grip/1.jpg",
        ],
    },
    {
        "slug": "overhead_press",
        "name": "Overhead Press",
        "category": "strength",
        "primary_muscle": "shoulders / triceps",
        "equipment": "barbell",
        "difficulty": 3,
        "is_bodyweight": False,
        "measurement": "reps_weight",
        "instructions": (
            "Standing with bar at the front rack, elbows slightly ahead "
            "of the bar. Brace core and glutes. Press the bar straight "
            "up; tuck the chin as the bar passes the face, then push "
            "the head 'through' at lockout. Lower under control."
        ),
        "cue": "Squeeze glutes + ribs down — no hyperextension on the press.",
        "images": [
            f"{_BASE}/Standing_Military_Press/0.jpg",
            f"{_BASE}/Standing_Military_Press/1.jpg",
        ],
    },

    # --- Joint-snacks library: high-conviction × no-equipment ---
    # Selected from the user-authored evidence-graded protocol library.
    # All RCT / MECHANISM tier; one PRACTITIONER-tier inclusion to close
    # the horizontal-pull pattern gap (no RCT for the bodyweight variant
    # but ubiquitous in calisthenics canon). Images intentionally [] —
    # the operator sources via the admin "Find" flow (see CLAUDE.md
    # self-hosted exercise images workflow). MAX_IMAGELESS ratchet bumps
    # to 13 in the same PR to reflect the gap.
    {
        "slug": "bird_dog",
        "name": "Bird Dog",
        "category": "mobility",
        "primary_muscle": "spinal stabilizers",
        "equipment": "none",
        "difficulty": 1,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Quadruped (hands under shoulders, knees under hips). "
            "Reach the opposite arm + leg until both are parallel to the "
            "floor, holding a neutral spine. Bring elbow + knee together "
            "under the torso, then re-extend. Switch sides."
        ),
        "cue": "Hips stay level — don't let the supporting hip drop. Pause 2 sec at full reach.",
        "evidence_tier": "MECHANISM",
        "images": [],
    },
    {
        "slug": "dead_bug",
        "name": "Dead Bug",
        "category": "mobility",
        "primary_muscle": "deep core (anti-extension)",
        "equipment": "none",
        "difficulty": 1,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Supine, knees + hips at 90°, arms reaching toward the ceiling. "
            "Slowly lower the opposite arm and leg toward the floor without "
            "letting the lower back arch off the floor. Return and switch."
        ),
        "cue": "Press low back into the floor before you move — keep it pinned the whole rep.",
        "evidence_tier": "MECHANISM",
        "images": [],
    },
    {
        "slug": "side_plank",
        "name": "Side Plank",
        "category": "mobility",
        "primary_muscle": "obliques / QL (anti-lateral-flexion)",
        "equipment": "none",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "duration",
        "instructions": (
            "Side-lying, forearm under shoulder, legs stacked. Lift the "
            "hips so the body forms a straight line from ankles to head. "
            "Hold without letting the bottom hip sag. Switch sides."
        ),
        "cue": "Drive the bottom hip up — the goal is a hard straight line, not a sag.",
        "evidence_tier": "MECHANISM",
        "images": [],
    },
    # NOTE: single_leg_glute_bridge already exists in the original seed
    # (used by the rotator_reset routine). Re-using the existing slug —
    # the snapshot entry gets evidence_tier="MECHANISM" applied via the
    # snapshot file directly. The pull_hip_snack routine references the
    # existing slug.
    {
        "slug": "push_up_plus",
        "name": "Push-Up Plus (Scap Push-Up)",
        "category": "strength",
        "primary_muscle": "serratus anterior",
        "equipment": "none",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Top of a push-up position with arms straight. Without bending "
            "the elbows, let the chest sink between the shoulder blades, "
            "then push the floor away to round the upper back — the "
            "shoulder blades wrap around the rib cage. The elbows do not move."
        ),
        "cue": "Arms stay locked. The motion is at the shoulder blades, not the elbows.",
        "evidence_tier": "MECHANISM",
        "images": [],
    },
    {
        "slug": "wall_sit_isometric",
        "name": "Wall Sit (Isometric)",
        "category": "strength",
        "primary_muscle": "quadriceps",
        "equipment": "wall",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "duration",
        "instructions": (
            "Back against a wall, slide down until thighs are parallel to "
            "the floor, knees over ankles. Hold. ≥ 6 hours between sessions "
            "if used for tendon-isometric programming."
        ),
        "cue": "Knees track over the toes. Drive heels down, ribs stacked over hips.",
        "evidence_tier": "MECHANISM",
        "images": [],
    },
    {
        "slug": "wall_slide",
        "name": "Wall Slide",
        "category": "mobility",
        "primary_muscle": "serratus / scap upward rotation",
        "equipment": "wall",
        "difficulty": 1,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Stand with back against a wall, arms in a goalpost shape "
            "(elbows at 90°, backs of forearms against the wall). Slide "
            "the arms up overhead while maintaining contact with the wall, "
            "then slide back down. Move only as far as the wall contact "
            "allows."
        ),
        "cue": "Ribs down — don't arch the lower back to fake the overhead reach.",
        "evidence_tier": "MECHANISM",
        "images": [],
    },
    {
        "slug": "eccentric_heel_drops_alfredson",
        "name": "Eccentric Heel Drops (Alfredson)",
        "category": "rehab",
        "primary_muscle": "gastrocnemius / Achilles tendon",
        "equipment": "step edge",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Stand on a step with heels hanging off the edge. Rise on both "
            "toes, shift weight to the working leg, and lower the heel below "
            "the step over 3 seconds. Use the other leg to return to the top. "
            "Standard Alfredson dose: 3 × 15 straight-knee + 3 × 15 bent-knee, "
            "twice daily."
        ),
        "cue": "3-second descent, no bounce at the bottom, control through full range.",
        "evidence_tier": "RCT",
        "images": [],
    },
    {
        "slug": "copenhagen_plank",
        "name": "Copenhagen Plank",
        "category": "strength",
        "primary_muscle": "hip adductors",
        "equipment": "couch arm or chair",
        "difficulty": 3,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Side-plank position with the top leg's inside-of-ankle resting "
            "on a couch arm or chair (long lever) or the partner's knee "
            "(short lever). Drive the top leg down into the support to lift "
            "the body into a straight side-plank. Lower under control over 3 sec. "
            "Harøy 2019 progression: 1 × 3 short-lever → 3 × 10 long-lever."
        ),
        "cue": "Long body line. The bottom leg is a passive prop; the top leg does the work.",
        "evidence_tier": "RCT",
        "images": [],
    },
    {
        "slug": "cross_body_stretch_with_scap_stab",
        "name": "Cross-Body Stretch (Scap-Stabilized)",
        "category": "mobility",
        "primary_muscle": "posterior shoulder capsule",
        "equipment": "wall",
        "difficulty": 1,
        "is_bodyweight": True,
        "measurement": "duration",
        "instructions": (
            "Stand with the working shoulder against a wall (or use the "
            "opposite hand to pin the scapula down + back). Bring the "
            "working arm horizontally across the chest. The wall / opposite "
            "hand keeps the scapula stable so the stretch lands at the "
            "glenohumeral joint, not by rotating the shoulder blade. Hold."
        ),
        "cue": "Scapula stays pinned — feel the stretch at the back of the shoulder, not the upper trap.",
        "evidence_tier": "RCT",
        "images": [],
    },
    {
        "slug": "inverted_row",
        "name": "Inverted Row (Australian Pull-Up)",
        "category": "strength",
        "primary_muscle": "mid-back / rhomboids",
        "equipment": "sturdy table or low bar",
        "difficulty": 2,
        "is_bodyweight": True,
        "measurement": "reps",
        "instructions": (
            "Lie on your back under a sturdy table or low bar. Grip the "
            "edge with hands just outside shoulder width. Pull the chest "
            "up to the bar / table edge, keeping the body in a straight "
            "line from heels to head. Lower under control."
        ),
        "cue": "Drive elbows down and back. Squeeze the shoulder blades at the top.",
        "evidence_tier": "PRACTITIONER",
        "images": [],
    },
]


# Routine definitions: each routine is a list of (slug, {targets}).
# keystone=True marks "don't skip even if short on time".

ROUTINES = {}

ROUTINES["ankle"] = {
    "name": "Ankle Mobility AM",
    "goal": "rehab",
    "notes": "Daily ankle/calf rehab routine. ~15 min. Wall dorsiflexion is the keystone.",
    "exercises": [
    ("wall_ankle_dorsiflexion", {"target_sets": 2, "target_duration_sec": 120, "rest_sec": 15,
                                  "keystone": True, "notes": "Both sides. The ONE thing — never skip."}),
    ("eccentric_calf_raise_straight", {"target_sets": 3, "target_reps": 15, "rest_sec": 60,
                                        "tempo": "0-0-3-0", "notes": "3-sec descent."}),
    ("eccentric_calf_raise_bent", {"target_sets": 3, "target_reps": 15, "rest_sec": 60,
                                    "tempo": "0-0-3-0", "notes": "3-sec descent, knee bent."}),
    ("plantar_fascia_roll", {"target_sets": 1, "target_duration_sec": 120, "rest_sec": 0,
                              "notes": "Right foot only (or both)."}),
    ("half_kneeling_hip_flexor", {"target_sets": 2, "target_duration_sec": 90, "rest_sec": 15,
                                   "notes": "Both sides, focus right. Squeeze glute first."}),
    ("single_leg_glute_bridge", {"target_sets": 3, "target_reps": 12, "rest_sec": 45,
                                  "notes": "Per side. Pause 1 sec at top."}),
    ],
}

ROUTINES["rotator_reset"] = {
    "name": "Hip External Rotator Reset",
    "goal": "rehab",
    "notes": ("Wake up dormant rotators → restore glute-driven extension → release compensatory tightness. "
              "Targets femoral alignment. ~20-25 min."),
    "exercises": [
        # 1. Wake up the external rotators
        ("isometric_seated_external_rotation", {"target_sets": 3, "target_duration_sec": 15, "rest_sec": 30,
                                                  "keystone": True,
                                                  "notes": "Activation. Per side. Gentle press — no joint motion."}),
        ("clamshell_banded", {"target_sets": 2, "target_reps": 25, "rest_sec": 45,
                               "tempo": "2-1-2-0",
                               "notes": "Endurance. Per side, 20-30 reps. Pelvis stays still."}),
        ("banded_fire_hydrant", {"target_sets": 3, "target_reps": 12, "rest_sec": 45,
                                  "notes": "Per side. Hips level, don't rotate."}),
        # 2. Restore glute-driven extension
        ("banded_glute_bridge", {"target_sets": 3, "target_reps": 15, "rest_sec": 45,
                                   "keystone": True,
                                   "notes": "Push knees OUT against band as you bridge up."}),
        ("banded_lateral_walk", {"target_sets": 3, "target_reps": 10, "rest_sec": 45,
                                   "notes": "'Monster walks.' Small steps, partial squat."}),
        ("single_leg_rdl", {"target_sets": 3, "target_reps": 8, "rest_sec": 60,
                             "notes": "Per side. Knee tracks over 2nd toe — NO valgus collapse."}),
        # 3. Release compensatory tightness
        ("half_kneeling_hip_flexor", {"target_sets": 2, "target_duration_sec": 75, "rest_sec": 15,
                                        "notes": "Per side. Squeeze glute of trailing leg, tuck pelvis."}),
        ("figure_4_stretch", {"target_sets": 2, "target_duration_sec": 60, "rest_sec": 15,
                               "notes": "Per side. Shoulders flat. Releases deep rotators."}),
    ],
}

# --- Quick-duration joint snacks (target_minutes 4-6, real goal preserved) ---
# Companion routines for the 11 joint-snacks exercises above. `goal`
# stays the routine's actual category (mobility / strength / rehab);
# `target_minutes` is the orthogonal duration signal that drives the
# routine-card duration pill + future "≤5 min" filter.

ROUTINES["core_anti_trio"] = {
    "name": "Core Anti-Trio",
    "goal": "mobility",
    "notes": "McGill big-3 spine-stability snack. ~5 min. All three are anti-pattern: anti-rotation (bird dog), anti-extension (dead bug), anti-lateral-flexion (side plank).",
    "target_minutes": 5,
    "exercises": [
        ("bird_dog", {"target_sets": 2, "target_reps": 8, "rest_sec": 30,
                      "notes": "Per side. 2-sec hold at full reach."}),
        ("dead_bug", {"target_sets": 2, "target_reps": 8, "rest_sec": 30,
                      "notes": "Per side. Low back stays pinned."}),
        ("side_plank", {"target_sets": 2, "target_duration_sec": 30, "rest_sec": 30,
                        "keystone": True,
                        "notes": "Per side. Hard straight line, no sag."}),
    ],
}

ROUTINES["shoulder_snack"] = {
    "name": "Shoulder Snack",
    "goal": "mobility",
    "notes": "Cuff + serratus + posterior capsule, in 6 min. Cross-body stretch is the keystone — biggest evidence base for IR ROM.",
    "target_minutes": 6,
    "exercises": [
        ("wall_slide", {"target_sets": 2, "target_reps": 10, "rest_sec": 30,
                        "notes": "Ribs down, no lumbar arch."}),
        ("cross_body_stretch_with_scap_stab", {"target_sets": 3, "target_duration_sec": 30, "rest_sec": 15,
                                                "keystone": True,
                                                "notes": "Per side. Pin the scapula first."}),
        ("push_up_plus", {"target_sets": 2, "target_reps": 10, "rest_sec": 45,
                          "notes": "Slow protraction at the top."}),
    ],
}

ROUTINES["tendon_isometric_snack"] = {
    "name": "Tendon Isometric Snack",
    "goal": "rehab",
    "notes": "Achilles eccentric + knee-tendon isometric. ≥6 h between bouts if used as Baar-style tendon programming.",
    "target_minutes": 5,
    "exercises": [
        ("eccentric_heel_drops_alfredson", {"target_sets": 3, "target_reps": 15, "rest_sec": 60,
                                             "tempo": "0-0-3-0",
                                             "keystone": True,
                                             "notes": "3-sec descent, both straight + bent knee. Per-side optional."}),
        ("wall_sit_isometric", {"target_sets": 5, "target_duration_sec": 30, "rest_sec": 60,
                                 "notes": "70% effort. Drive heels down."}),
    ],
}

ROUTINES["pull_hip_snack"] = {
    "name": "Pull + Hip Snack",
    "goal": "strength",
    "notes": "Horizontal pull + glute drive in 5 min. Closes the pulling-pattern gap that pushup-only routines leave open.",
    "target_minutes": 5,
    "exercises": [
        ("inverted_row", {"target_sets": 3, "target_reps": 8, "rest_sec": 60,
                          "keystone": True,
                          "notes": "Body straight from heels to head. Adjust angle for difficulty."}),
        ("single_leg_glute_bridge", {"target_sets": 3, "target_reps": 10, "rest_sec": 45,
                                      "notes": "Per side. Pause 1 sec at top."}),
    ],
}

ROUTINES["copenhagen_prehab"] = {
    "name": "Copenhagen Prehab",
    "goal": "strength",
    "notes": "Single-move adductor prehab. Harøy 2019 BJSM RCT (n=632) showed −41% groin problems with 1 ×/week in-season dosing.",
    "target_minutes": 4,
    "exercises": [
        ("copenhagen_plank", {"target_sets": 3, "target_reps": 10, "rest_sec": 90,
                               "tempo": "1-0-3-0",
                               "keystone": True,
                               "notes": "Per side. Long-lever (foot on chair). Regress to short-lever (foot on partner's knee) if 8 reps is unstable."}),
    ],
}


# --- User-authored rehab protocols --------------------------------------
# Live in the seed file so they ship with the codebase + can be re-seeded
# after a DB rebuild. Distinguish from the joint-snacks library by the
# `tracks_symptoms: True` flag — these routines opt sessions into the
# pain-monitored progression path (Silbernagel-style advance / hold /
# back-off rather than the default RPE algorithm).

ROUTINES["knee_valgus_pt"] = {
    "name": "Knee Valgus PT",
    "goal": "rehab",
    "tracks_symptoms": True,
    "target_minutes": 28,
    "notes": (
        "Three-block knee-valgus PT protocol: hip stabilizers + posterior-chain → "
        "ankle/calf mobility + eccentric loading → hip flexor mobility. "
        "Right side prioritized (operator's affected side); per-exercise notes "
        "carry the L/R bias so set logging stays asymmetric. tracks_symptoms=True "
        "→ pain chip per set drives advance/hold/back-off."
    ),
    "exercises": [
        # Block 1 — strength / activation
        ("clamshell_banded", {"target_sets": 3, "target_reps": 15, "rest_sec": 45,
                              "tempo": "2-2-3-0",
                              "keystone": True,
                              "notes": "Right side only. Band above knees. 2s up, 2s hold, 3s down."}),
        ("banded_lateral_walk", {"target_sets": 3, "target_reps": 10, "rest_sec": 45,
                                 "notes": "10 steps each direction (R then L). Quarter squat, toes pointed forward."}),
        ("side_lying_hip_abduction", {"target_sets": 3, "target_reps": 12, "rest_sec": 45,
                                       "notes": "Right side only. Straight leg, toe rotated toward ceiling. Slow + controlled."}),
        ("single_leg_glute_bridge", {"target_sets": 3, "target_reps": 12, "rest_sec": 45,
                                      "notes": "Both sides — focus right. Hold 1s at the top."}),
        # Block 2 — ankle / calf mobility + eccentric load
        ("banded_ankle_mobilization", {"target_sets": 1, "target_duration_sec": 120, "rest_sec": 30,
                                        "notes": "Right side only. Half-kneeling, band pulls talus posterior."}),
        ("seated_soleus_stretch", {"target_sets": 1, "target_duration_sec": 90, "rest_sec": 30,
                                    "notes": "Right side. Chair, lean forward, drive knee over toes."}),
        ("eccentric_calf_raise_straight", {"target_sets": 3, "target_reps": 15, "rest_sec": 60,
                                            "tempo": "0-0-3-0",
                                            "notes": "Both sides. 3-second lowering. Off step edge, full stretch at bottom."}),
        ("eccentric_calf_raise_bent", {"target_sets": 3, "target_reps": 15, "rest_sec": 60,
                                        "tempo": "0-0-3-0",
                                        "notes": "Both sides. 3-second lowering. Knees bent ~20° to bias soleus."}),
        ("plantar_fascia_roll", {"target_sets": 1, "target_duration_sec": 120, "rest_sec": 30,
                                  "notes": "Right side only. Lacrosse ball or frozen bottle on sole."}),
        # Block 3 — hip flexor mobility
        ("half_kneeling_hip_flexor", {"target_sets": 2, "target_duration_sec": 90, "rest_sec": 30,
                                       "notes": "Both sides — prioritize right (run R first + add a 3rd 90s set on R if time allows). Squeeze glute on the stretching side."}),
    ],
}


# Backwards-compat alias
ANKLE_ROUTINE_TARGETS = ROUTINES["ankle"]["exercises"]


# Routines that should auto-seed for every existing user on every release.
# Treated as "global" — same shape as the global exercise library, but
# routines are inherently user-scoped because they carry user_id, so we
# materialize one row per (user, routine) pair. `seed_routine_for` is
# idempotent (skips when a row with the same name already exists for the
# user), so re-running this on every deploy is safe.
#
# Add a slug here to make it part of the default install for every user.
# Per-user-only routines (e.g. someone's custom rehab plan) stay out of
# this list and only seed when explicitly invoked with
# `python seed_workouts.py <email> <slug>`.
GLOBAL_ROUTINES: list[str] = ["knee_valgus_pt"]


def seed_global_routines_for_all_users() -> int:
    """Iterate every registered user and ensure each has rows for every
    slug in GLOBAL_ROUTINES. Returns the count of routines created
    (skipped duplicates aren't counted). Called from the bare-args
    `python seed_workouts.py` path that runs as part of the Fly
    release_command — so a fresh deploy after adding to GLOBAL_ROUTINES
    materializes the new routine for the operator without manual
    `fly ssh`."""
    created = 0
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email FROM users ORDER BY id")
        emails = [r["email"] for r in cur.fetchall()]
    for email in emails:
        for slug in GLOBAL_ROUTINES:
            if slug not in ROUTINES:
                print(f"WARN: GLOBAL_ROUTINES references unknown slug '{slug}' — skipping")
                continue
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT 1 FROM users u "
                    "JOIN routines r ON r.user_id = u.id "
                    "WHERE u.email = ? AND r.name = ? LIMIT 1",
                    (email, ROUTINES[slug]["name"]),
                )
                if cur.fetchone():
                    continue
            seed_routine_for(email, slug)
            created += 1
    if not emails:
        print("seed_global_routines_for_all_users: no users yet — nothing to seed")
    return created


def seed_exercises():
    inserted = 0
    with get_db() as conn:
        cur = conn.cursor()
        for ex in EXERCISES:
            cur.execute("SELECT id FROM exercises WHERE slug = ? AND user_id IS NULL", (ex["slug"],))
            if cur.fetchone():
                continue
            cur.execute(
                """INSERT INTO exercises
                (user_id, name, slug, category, primary_muscle, equipment, difficulty,
                 is_bodyweight, measurement, instructions, cue, evidence_tier)
                VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (ex["name"], ex["slug"], ex["category"], ex["primary_muscle"],
                 ex["equipment"], ex["difficulty"], bool(ex["is_bodyweight"]),
                 ex["measurement"], ex["instructions"], ex["cue"], ex.get("evidence_tier")),
            )
            ex_id = cur.lastrowid
            for idx, url in enumerate(ex.get("images", [])):
                cur.execute(
                    "INSERT INTO exercise_images (exercise_id, url, sort_order) VALUES (?, ?, ?)",
                    (ex_id, url, idx),
                )
            inserted += 1
    print(f"Seeded {inserted} new exercises (skipped {len(EXERCISES) - inserted} existing).")


def _replace_images(cur, exercise_id: int, urls: list[str]) -> None:
    """Wipe and re-insert images for an exercise. Used by the snapshot path
    where the JSON is the source of truth."""
    cur.execute("DELETE FROM exercise_images WHERE exercise_id = ?", (exercise_id,))
    for i, url in enumerate(urls):
        if not url:
            continue
        cur.execute(
            "INSERT INTO exercise_images (exercise_id, url, sort_order) VALUES (?, ?, ?)",
            (exercise_id, url, i),
        )


def seed_from_snapshot(snapshot_path: Path = SNAPSHOT_PATH) -> int:
    """Upsert global exercises (and their image lists) from the JSON snapshot
    produced by `scripts/snapshot_exercises.py`. Returns the number of rows
    touched. Safe to re-run."""
    if not snapshot_path.exists():
        return 0
    try:
        payload = json.loads(snapshot_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        print(f"WARN: couldn't read snapshot {snapshot_path}: {exc}", file=sys.stderr)
        return 0

    exercises = payload.get("exercises") or []
    inserted = 0
    updated = 0
    with get_db() as conn:
        cur = conn.cursor()
        for ex in exercises:
            slug = ex.get("slug")
            if not slug:
                continue
            cur.execute(
                "SELECT id FROM exercises WHERE slug = ? AND user_id IS NULL",
                (slug,),
            )
            row = cur.fetchone()
            fields = (
                ex.get("name"), slug, ex.get("category"),
                ex.get("primary_muscle"), ex.get("equipment"), ex.get("difficulty"),
                bool(ex.get("is_bodyweight")), ex.get("measurement"),
                ex.get("instructions"), ex.get("cue"), ex.get("contraindications"),
                ex.get("min_age"), ex.get("max_age"),
                # evidence_tier carries operator-curated provenance through
                # the DR restore + manual reseed paths. Earlier draft of the
                # PR dropped this on the floor — every populated tier silently
                # reverted to NULL on the next snapshot load.
                ex.get("evidence_tier"),
            )
            if row:
                ex_id = row["id"]
                cur.execute(
                    """UPDATE exercises SET
                        name = ?, slug = ?, category = ?, primary_muscle = ?,
                        equipment = ?, difficulty = ?, is_bodyweight = ?,
                        measurement = ?, instructions = ?, cue = ?,
                        contraindications = ?, min_age = ?, max_age = ?,
                        evidence_tier = ?
                       WHERE id = ?""",
                    fields + (ex_id,),
                )
                updated += 1
            else:
                cur.execute(
                    """INSERT INTO exercises
                       (user_id, name, slug, category, primary_muscle, equipment, difficulty,
                        is_bodyweight, measurement, instructions, cue, contraindications,
                        min_age, max_age, evidence_tier)
                       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    fields,
                )
                ex_id = cur.lastrowid
                inserted += 1
            _replace_images(cur, ex_id, ex.get("images") or [])

    print(f"Snapshot: {inserted} inserted, {updated} updated ({snapshot_path.name}).")
    return inserted + updated


def resync_global_images():
    """Wipe and re-insert images for global exercises based on IMAGES dict."""
    updated = 0
    with get_db() as conn:
        cur = conn.cursor()
        for slug, urls in IMAGES.items():
            cur.execute("SELECT id FROM exercises WHERE slug = ? AND user_id IS NULL", (slug,))
            row = cur.fetchone()
            if not row:
                print(f"  skip: {slug} not seeded yet")
                continue
            ex_id = row["id"]
            cur.execute("DELETE FROM exercise_images WHERE exercise_id = ?", (ex_id,))
            for i, url in enumerate(urls):
                cur.execute(
                    "INSERT INTO exercise_images (exercise_id, url, sort_order) VALUES (?, ?, ?)",
                    (ex_id, url, i),
                )
            updated += 1
            print(f"  {slug}: {len(urls)} image(s)")
    print(f"Resynced {updated} exercises.")


def seed_routine_for(email: str, routine_key: str):
    spec = ROUTINES.get(routine_key)
    if not spec:
        print(f"Unknown routine '{routine_key}'. Options: {', '.join(ROUTINES)}")
        sys.exit(1)
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email = ?", (email,))
        u = cur.fetchone()
        if not u:
            print(f"User {email} not found.")
            sys.exit(1)
        user_id = u["id"]

        cur.execute("SELECT id FROM routines WHERE user_id = ? AND name = ?",
                    (user_id, spec["name"]))
        if cur.fetchone():
            print(f"Routine '{spec['name']}' already exists for this user — skipping.")
            return

        # tracks_symptoms is opt-in per-routine (default False) and honored
        # at seed time so rehab protocols inherit the pain-monitored
        # progression path without a manual toggle after seed runs.
        cur.execute(
            """INSERT INTO routines
               (user_id, name, goal, notes, target_minutes, tracks_symptoms)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (user_id, spec["name"], spec["goal"], spec["notes"],
             spec.get("target_minutes"), bool(spec.get("tracks_symptoms", False))),
        )
        rid = cur.lastrowid
        for idx, (slug, t) in enumerate(spec["exercises"]):
            cur.execute("SELECT id FROM exercises WHERE slug = ? AND user_id IS NULL", (slug,))
            ex = cur.fetchone()
            if not ex:
                print(f"WARN: exercise '{slug}' missing — run seed first.")
                continue
            cur.execute(
                """INSERT INTO routine_exercises
                (routine_id, exercise_id, sort_order, target_sets, target_reps,
                 target_duration_sec, rest_sec, tempo, keystone, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (rid, ex["id"], idx, t.get("target_sets"), t.get("target_reps"),
                 t.get("target_duration_sec"), t.get("rest_sec", 60), t.get("tempo"),
                 bool(t.get("keystone", False)), t.get("notes")),
            )
        print(f"Created '{spec['name']}' routine for {email} ({len(spec['exercises'])} exercises).")


def usage():
    print("Usage:")
    print("  python seed_workouts.py                           # seed global exercises only")
    print("  python seed_workouts.py <email>                   # seed + create 'ankle' routine (default)")
    print("  python seed_workouts.py <email> <routine>         # seed + create specified routine")
    print("  python seed_workouts.py <email> all               # seed + create ALL routines")
    print(f"\nAvailable routines: {', '.join(ROUTINES)}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help"):
        usage()
        sys.exit(0)
    init_db()
    if len(sys.argv) > 1 and sys.argv[1] == "--resync-images":
        resync_global_images()
        sys.exit(0)
    # Snapshot is the canonical source once adopted. The hardcoded EXERCISES
    # list only runs when no snapshot exists (fresh-env bootstrap).
    if seed_from_snapshot() == 0:
        seed_exercises()
    # GLOBAL_ROUTINES auto-materialize for every registered user on every
    # release — this is what makes `knee_valgus_pt` appear in the
    # operator's account without a manual `fly ssh` step. Idempotent.
    seed_global_routines_for_all_users()
    if len(sys.argv) > 1:
        email = sys.argv[1]
        which = sys.argv[2] if len(sys.argv) > 2 else "ankle"
        if which == "all":
            for key in ROUTINES:
                seed_routine_for(email, key)
        else:
            seed_routine_for(email, which)
