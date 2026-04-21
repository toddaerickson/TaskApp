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

ROUTINES["phased"] = {
    "name": "Hip/Ankle Rehab (Phased)",
    "goal": "rehab",
    "notes": ("3 phases: hip activation → ankle/calf → hip flexor. ~25 min. "
              "NOTE: no unassisted wall dorsiflexion on right — use banded ankle mob instead."),
    "exercises": [
        # Phase 1 — Hip activation (~13 min)
        ("clamshell_banded", {"target_sets": 3, "target_reps": 15, "rest_sec": 45,
                               "tempo": "2-2-3-0", "keystone": True,
                               "notes": "Phase 1. Right side focus. 2s up / 2s hold / 3s down. "
                                        "If felt in front of hip, reduce range."}),
        ("banded_lateral_walk", {"target_sets": 3, "target_reps": 10, "rest_sec": 45,
                                  "notes": "Phase 1. 10 steps each direction, quarter squat, toes forward."}),
        ("side_lying_hip_abduction", {"target_sets": 3, "target_reps": 12, "rest_sec": 30,
                                       "notes": "Phase 1. Left side down, lift right leg, toe slightly toward ceiling."}),
        ("single_leg_glute_bridge", {"target_sets": 3, "target_reps": 12, "rest_sec": 45,
                                      "notes": "Phase 1. Per side, focus right."}),
        # Phase 2 — Ankle/calf (~9 min)
        ("banded_ankle_mobilization", {"target_sets": 1, "target_duration_sec": 120, "rest_sec": 0,
                                        "keystone": True,
                                        "notes": "Phase 2. Right ankle. REPLACES wall stretch on the right."}),
        ("seated_soleus_stretch", {"target_sets": 1, "target_duration_sec": 90, "rest_sec": 0,
                                    "notes": "Phase 2. Lean forward, knee over toes, heel planted."}),
        ("eccentric_calf_raise_straight", {"target_sets": 3, "target_reps": 15, "rest_sec": 60,
                                            "tempo": "0-0-3-0", "notes": "Phase 2. 3-sec descent."}),
        ("eccentric_calf_raise_bent", {"target_sets": 3, "target_reps": 15, "rest_sec": 60,
                                        "tempo": "0-0-3-0", "notes": "Phase 2. Knee bent."}),
        ("plantar_fascia_roll", {"target_sets": 1, "target_duration_sec": 120, "rest_sec": 0,
                                  "notes": "Phase 2. Right foot."}),
        # Phase 3 — Hip flexor (~3 min)
        ("half_kneeling_hip_flexor", {"target_sets": 2, "target_duration_sec": 90, "rest_sec": 15,
                                       "notes": "Phase 3. Both sides, priority right. Squeeze glute first."}),
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

# Backwards-compat alias
ANKLE_ROUTINE_TARGETS = ROUTINES["ankle"]["exercises"]


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
                 is_bodyweight, measurement, instructions, cue)
                VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (ex["name"], ex["slug"], ex["category"], ex["primary_muscle"],
                 ex["equipment"], ex["difficulty"], bool(ex["is_bodyweight"]),
                 ex["measurement"], ex["instructions"], ex["cue"]),
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
            )
            if row:
                ex_id = row["id"]
                cur.execute(
                    """UPDATE exercises SET
                        name = ?, slug = ?, category = ?, primary_muscle = ?,
                        equipment = ?, difficulty = ?, is_bodyweight = ?,
                        measurement = ?, instructions = ?, cue = ?,
                        contraindications = ?, min_age = ?, max_age = ?
                       WHERE id = ?""",
                    fields + (ex_id,),
                )
                updated += 1
            else:
                cur.execute(
                    """INSERT INTO exercises
                       (user_id, name, slug, category, primary_muscle, equipment, difficulty,
                        is_bodyweight, measurement, instructions, cue, contraindications,
                        min_age, max_age)
                       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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

        cur.execute(
            "INSERT INTO routines (user_id, name, goal, notes) VALUES (?, ?, ?, ?)",
            (user_id, spec["name"], spec["goal"], spec["notes"]),
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
    if len(sys.argv) > 1:
        email = sys.argv[1]
        which = sys.argv[2] if len(sys.argv) > 2 else "ankle"
        if which == "all":
            for key in ROUTINES:
                seed_routine_for(email, key)
        else:
            seed_routine_for(email, which)
