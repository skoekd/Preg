// NurtureStrength MVP (no-build, vanilla JS)
// - Multi-step onboarding wizard with dropdowns/collapsibles to reduce scroll
// - Constraint/modifier engine: base templates + dials -> exercise substitutions + dosage changes
// - Save plans to localStorage with naming + export/import JSON

(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  const ROUTES = ["workout","profile","history","about","setup"];
  let state = {
    route: "workout",
    wizardStep: 0,
    profile: defaultProfile(),
    generatedPlan: null,
    activeSavedId: null,
    activeWeekIndex: 0,
    editingLogId: null,
  };

  function defaultProfile(){
    return {
      clearanceAcknowledged: false,
      providerRestrictions: { has: false, tags: [], notes: "" },

      stage: { mode: "pregnant", weeksPregnant: 20, weeksPostpartum: 0, deliveryType:"vaginal", breastfeeding:false, dueDate:"", postpartumPlanWeeks: 24 },

      // Program structure controls how workouts differ across days.
      // Supported: full_body, upper_lower, ab_split, abc_rotation
      schedule: { daysPerWeek: 3, sessionMinutes: 30, style: "full_body", preferredDays: [] },

      equipment: { set: "gym_full", cardio: "walking", balanceLimit: false },

      training: { experience:"intermediate", confidence: { squat:"confident", hinge:"confident", push:"confident", pull:"confident", carry:"confident" }, injuries: [] },

      symptoms: {}, // filled from UI (severity + triggers)
      diagnoses: [], // list of strings
      hardLimits: { avoidSupine:false, avoidHeavy:false, avoidImpact:true, avoidBarbell:false, avoidRunning:false, painStopAt:4,
                    stopOnLeakage:true, stopOnHeaviness:true, stopOnDoming:true },

      goals: ["maintain_strength","reduce_pain"],

      // User-driven difficulty preference. Used to gently adjust volume/intensity guidance.
      // Values: "standard" | "slightly_harder" | "much_harder"
      difficulty: { preference:"standard", notes:"" },

      tone: "direct",
      lifestyle: { sleepHours: 7, workDemands:"mixed", activity:"moderate", stress:"moderate", support:"moderate" },
    };
  }

  // --- Data: symptom + diagnoses sets (with dropdowns)
  const SEVERITY = ["none","mild","moderate","severe"];

  function maxSev(a,b){
    const ia = SEVERITY.indexOf(a||"none");
    const ib = SEVERITY.indexOf(b||"none");
    return SEVERITY[Math.max(0, ia, ib)];
  }
  const SYMPTOMS = [
    {key:"pelvic_pressure", label:"Pelvic heaviness/pressure", affects:["IAP","ROM","FATIGUE"]},
    {key:"leakage", label:"Leaking with effort/cough/sneeze", affects:["IAP","FATIGUE"]},
    {key:"doming", label:"Abdominal doming/coning with exertion", affects:["IAP","ROM"]},
    {key:"pgp", label:"Pelvic girdle pain (PGP/SPD)", affects:["ASYM","ROM"]},
    {key:"low_back", label:"Low back pain", affects:["ROM","FATIGUE"]},
    {key:"si_pain", label:"SI joint pain", affects:["ASYM","ROM"]},
    {key:"round_lig", label:"Round ligament pain", affects:["ROM","BAL"]},
    {key:"carpal_tunnel", label:"Carpal tunnel / wrist symptoms", affects:["GRIP"]},
    {key:"varicose", label:"Varicose/pelvic congestion symptoms", affects:["UPRIGHT","FATIGUE"]},
    {key:"reflux", label:"Reflux / GERD", affects:["POSITION"]},
    {key:"dizziness", label:"Dizziness/orthostatic symptoms", affects:["HEMO","BAL"]},
    {key:"fatigue", label:"Severe fatigue / poor sleep", affects:["FATIGUE"]},
    {key:"nausea", label:"Nausea/vomiting limiting training", affects:["FATIGUE"]},
    {key:"breathless", label:"Breathlessness limiting exertion", affects:["IAP","HEMO"]},
    {key:"headaches", label:"Headaches/migraines", affects:["HEMO","FATIGUE"]},
  ];

  const DIAGNOSES = [
    {key:"sch", label:"Subchorionic hematoma / bleeding history", class:"yellow", modifies:{IAP:+2,FATIGUE:+2,BAL:+1,IMPACT:+3,ISOMETRIC:+2}},
    {key:"previa", label:"Placenta previa / low-lying placenta", class:"yellow", modifies:{IAP:+2,UPRIGHT:+2,ROM:+1,CARRY:+2}},
    {key:"htn", label:"Hypertension / gestational hypertension", class:"yellow", modifies:{HEMO:+2,IAP:+1,ISOMETRIC:+2}},
    {key:"gdm", label:"Gestational diabetes", class:"green", modifies:{FREQ:-1,DENSITY:-1}}, // negative = can increase training frequency/density mildly
    {key:"anemia", label:"Anemia", class:"yellow", modifies:{FATIGUE:+2,DENSITY:+2}},
    {key:"cerclage", label:"Cervical insufficiency / cerclage", class:"red", modifies:{IAP:+3,UPRIGHT:+3,CARRY:+3,ROM:+2}},
    {key:"preterm_history", label:"History of preterm labor", class:"yellow", modifies:{FATIGUE:+2,IAP:+1,IMPACT:+3}},
    {key:"multiples", label:"Multiple pregnancy (twins+)", class:"yellow", modifies:{FATIGUE:+2,BAL:+2,IAP:+1,AXIAL:+1}},
    {key:"other", label:"Other (write in notes)", class:"yellow", modifies:{}},
  ];

  // --- Base templates (stage-aware)
  // Plan structure: days -> blocks -> exercises with tags (pattern, position, iapLevel, grip, etc.)
  const EXERCISE_LIBRARY = {
    // Squat pattern
    squat: [
      {name:"Back Squat (barbell)", tags:{axial:3, iap:3, balance:2, position:"standing", impact:0, isometric:0, equip:["barbell","gym_full"]}},
      {name:"Front Squat (barbell)", tags:{axial:3, iap:3, balance:2, position:"standing", impact:0, isometric:0, equip:["barbell","gym_full"]}},
      {name:"Goblet Squat", tags:{axial:2, iap:2, balance:2, position:"standing", impact:0, isometric:0, equip:["dumbbells","gym_full","home_db"]}},
      {name:"Box Goblet Squat", tags:{axial:1, iap:2, balance:1, position:"standing", impact:0, isometric:0, equip:["dumbbells","gym_full","home_db"]}},
      {name:"Leg Press (machine)", tags:{axial:1, iap:1, balance:0, position:"seated", impact:0, isometric:0, equip:["gym_full"]}},
      {name:"Belt Squat (machine)", tags:{axial:1, iap:1, balance:0, position:"standing", impact:0, isometric:0, equip:["gym_full"]}},
      {name:"Hack Squat (machine)", tags:{axial:1, iap:1, balance:0, position:"standing", impact:0, isometric:0, equip:["gym_full"]}},
      {name:"Sit-to-Stand (bench)", tags:{axial:0, iap:0, balance:0, position:"seated", impact:0, isometric:0, equip:["home_db","bands_only","gym_full"]}},
    ],
    hinge: [
      {name:"Deadlift (barbell)", tags:{axial:2, iap:3, balance:2, position:"standing", impact:0, isometric:0, equip:["barbell","gym_full"]}},
      {name:"Trap Bar Deadlift", tags:{axial:2, iap:3, balance:2, position:"standing", impact:0, isometric:0, equip:["gym_full"]}},
      {name:"Romanian Deadlift (DB)", tags:{axial:1, iap:2, balance:2, position:"standing", impact:0, isometric:0, equip:["home_db","gym_full","dumbbells"]}},
      {name:"Supported DB RDL (hands on bench)", tags:{axial:1, iap:1, balance:1, position:"standing", impact:0, isometric:0, equip:["home_db","gym_full","dumbbells"]}},
      {name:"Cable Pull-Through", tags:{axial:0, iap:1, balance:1, position:"standing", impact:0, isometric:0, equip:["gym_full"]}},
      {name:"Elevated Deadlift (blocks/handles)", tags:{axial:1, iap:2, balance:1, position:"standing", impact:0, isometric:0, equip:["gym_full","barbell"]}},
      {name:"Hip Hinge Drill (dowel/wall)", tags:{axial:0, iap:0, balance:0, position:"standing", impact:0, isometric:0, equip:["bands_only","home_db","gym_full"]}},
    ],
    push: [
      {name:"Bench Press (barbell)", tags:{iap:2, position:"supine", grip:2, impact:0, isometric:0, equip:["barbell","gym_full"]}},
      {name:"Incline DB Press", tags:{iap:1, position:"incline", grip:2, impact:0, isometric:0, equip:["home_db","gym_full","dumbbells"]}},
      {name:"Landmine Press", tags:{iap:1, position:"standing", grip:1, impact:0, isometric:0, equip:["gym_full"]}},
      {name:"Seated Machine Press", tags:{iap:1, position:"seated", grip:1, impact:0, isometric:0, equip:["gym_full"]}},
      {name:"Seated DB Press", tags:{iap:1, position:"seated", grip:2, impact:0, isometric:0, equip:["home_db","gym_full","dumbbells"]}},
      {name:"Push-up (incline)", tags:{iap:1, position:"standing", grip:1, impact:0, isometric:1, equip:["bands_only","home_db","gym_full"]}},
    ],
    pull: [
      {name:"Barbell Row", tags:{iap:2, balance:2, grip:2, position:"standing", impact:0, isometric:0, equip:["barbell","gym_full"]}},
      // "Chest-supported" rows are typically prone on an incline bench. Great for many people,
      // but late pregnancy can make prone abdominal pressure uncomfortable/unsafe.
      {name:"Chest-Supported Row (incline bench)", tags:{iap:1, balance:0, grip:2, position:"prone_supported", abdomenPressure:2, impact:0, isometric:0, equip:["gym_full","home_db"]}},
      {name:"One-Arm DB Row (bench-supported)", tags:{iap:1, balance:1, grip:2, position:"supported", abdomenPressure:0, impact:0, isometric:0, equip:["gym_full","home_db","dumbbells"]}},
      {name:"Seated Machine Row", tags:{iap:1, balance:0, grip:1, position:"seated", abdomenPressure:0, impact:0, isometric:0, equip:["gym_full"]}},
      {name:"Seated Cable Row", tags:{iap:1, balance:0, grip:1, position:"seated", impact:0, isometric:0, equip:["gym_full"]}},
      {name:"Cable Row (neutral grip)", tags:{iap:1, balance:0, grip:1, position:"seated", impact:0, isometric:0, equip:["gym_full"]}},
      {name:"Lat Pulldown", tags:{iap:1, balance:0, grip:1, position:"seated", impact:0, isometric:0, equip:["gym_full"]}},
      {name:"Band Lat Pulldown (door anchor)", tags:{iap:0, balance:0, grip:0, position:"seated", impact:0, isometric:0, equip:["bands_only","home_db"]}},
      {name:"Band Row", tags:{iap:0, balance:0, grip:0, position:"standing", impact:0, isometric:0, equip:["bands_only","home_db","gym_full"]}},
    ],
    carry_core: [
      {name:"Suitcase Carry", tags:{iap:2, position:"standing", carry:2, grip:2, impact:0, isometric:0, equip:["home_db","gym_full","dumbbells"]}},
      {name:"Farmer Carry (light)", tags:{iap:2, position:"standing", carry:2, grip:2, impact:0, isometric:0, equip:["home_db","gym_full","dumbbells"]}},
      {name:"Pallof Press (anti-rotation)", tags:{iap:0, position:"standing", carry:0, grip:0, impact:0, isometric:1, equip:["bands_only","home_db","gym_full"]}},
      {name:"Tall-Kneeling Pallof Press", tags:{iap:0, position:"supported", carry:0, grip:0, impact:0, isometric:1, equip:["bands_only","home_db","gym_full"]}},
      {name:"Side Plank (modified)", tags:{iap:1, position:"side", carry:0, grip:0, impact:0, isometric:2, equip:["bands_only","home_db","gym_full"]}},
      {name:"Dead Bug (no doming)", tags:{iap:0, position:"supine", carry:0, grip:0, impact:0, isometric:0, equip:["bands_only","home_db","gym_full"]}},
      {name:"Bird Dog (slow)", tags:{iap:0, position:"supported", carry:0, grip:0, impact:0, isometric:1, equip:["bands_only","home_db","gym_full"]}},
      {name:"90/90 Breathing (rib stack)", tags:{iap:0, position:"supine", carry:0, grip:0, impact:0, isometric:0, equip:["bands_only","home_db","gym_full"]}},
    ],
    accessories: [
      {name:"Hip Thrust (bench)", tags:{iap:1, position:"supine", impact:0, isometric:0, equip:["gym_full","home_db"]}},
      {name:"Glute Bridge", tags:{iap:0, position:"supine", impact:0, isometric:0, equip:["bands_only","home_db","gym_full"]}},
      {name:"Glute Bridge Hold (short)", tags:{iap:0, position:"supine", impact:0, isometric:2, equip:["bands_only","home_db","gym_full"]}},
      {name:"Step-ups (low)", tags:{iap:1, balance:2, position:"standing", impact:1, isometric:0, equip:["gym_full","home_db"]}},
      {name:"Split Squat (short ROM)", tags:{iap:2, balance:2, position:"standing", impact:0, isometric:0, equip:["gym_full","home_db"]}},
      {name:"Wall Sit (short)", tags:{iap:1, position:"standing", impact:0, isometric:3, equip:["bands_only","home_db","gym_full"]}},
      {name:"Band Pull-Aparts", tags:{iap:0, position:"standing", impact:0, isometric:0, equip:["bands_only","home_db","gym_full"]}},
      {name:"Face Pull", tags:{iap:0, position:"standing", impact:0, isometric:0, equip:["gym_full"]}},
      {name:"Cat-Cow (gentle)", tags:{iap:0, position:"supported", impact:0, isometric:0, equip:["bands_only","home_db","gym_full"]}},
      {name:"Hip Flexor Stretch (supported)", tags:{iap:0, position:"supported", impact:0, isometric:1, equip:["bands_only","home_db","gym_full"]}},
      {name:"Thoracic Opener (side-lying)", tags:{iap:0, position:"side", impact:0, isometric:0, equip:["bands_only","home_db","gym_full"]}},
      {name:"Calf Raises", tags:{iap:0, position:"standing", impact:0, isometric:0, equip:["bands_only","home_db","gym_full"]}},
    ]
  };

  function stageKey(profile){
    const mode = profile.stage.mode;
    if(mode === "preconception") return "preconception";
    if(mode === "pregnant"){
      const w = profile.stage.weeksPregnant;
      if(w <= 13) return "t1";
      if(w <= 27) return "t2";
      return "t3";
    }
    // postpartum
    const p = profile.stage.weeksPostpartum;
    if(p < 6) return "pp0_6";
    if(p < 16) return "pp6_16";
    if(p < 52) return "pp4_12m";
    return "pp12m_plus";
  }

  const BASE_TEMPLATES = {
    preconception: { name:"Preconception Base", defaultDays:4, intensityBand:"moderate_to_high", rir: {main:"1-3", accessory:"2-4"},
      sessions: (days, profile)=> makeTemplateByStructure(days, "preconception", profile?.schedule?.style || "full_body")
    },
    t1: { name:"Pregnancy – 1st trimester", defaultDays:3, intensityBand:"moderate", rir:{main:"2-4", accessory:"3-5"},
      sessions: (days, profile)=> makeTemplateByStructure(days, "pregnancy", profile?.schedule?.style || "full_body")
    },
    t2: { name:"Pregnancy – 2nd trimester", defaultDays:3, intensityBand:"low_to_moderate", rir:{main:"3-5", accessory:"3-6"},
      sessions: (days, profile)=> makeTemplateByStructure(days, "pregnancy", profile?.schedule?.style || "full_body")
    },
    t3: { name:"Pregnancy – 3rd trimester", defaultDays:2, intensityBand:"low", rir:{main:"4-6", accessory:"5-7"},
      sessions: (days, profile)=> makeTemplateByStructure(days, "pregnancy_min", profile?.schedule?.style || "full_body")
    },
    pp0_6: { name:"Postpartum – 0 to 6 weeks (if cleared)", defaultDays:2, intensityBand:"very_low", rir:{main:"6-8", accessory:"6-8"},
      sessions: (days)=> makeTemplateRehab(days)
    },
    pp6_16: { name:"Postpartum – 6 to 16 weeks", defaultDays:3, intensityBand:"low", rir:{main:"4-6", accessory:"4-7"},
      sessions: (days, profile)=> makeTemplateByStructure(days, "postpartum_recon", profile?.schedule?.style || "full_body")
    },
    pp4_12m: { name:"Postpartum – 4 to 12 months", defaultDays:3, intensityBand:"moderate", rir:{main:"2-4", accessory:"2-5"},
      sessions: (days, profile)=> makeTemplateByStructure(days, "postpartum_reload", profile?.schedule?.style || "full_body")
    },
    pp12m_plus: { name:"Postpartum – 12+ months", defaultDays:4, intensityBand:"moderate_to_high", rir:{main:"1-3", accessory:"2-4"},
      sessions: (days, profile)=> makeTemplateByStructure(days, "performance", profile?.schedule?.style || "full_body")
    },
  };

  function makeTemplateByStructure(days, variant, structure){
    // Program structure selector:
    // - full_body: every day hits all patterns
    // - upper_lower: alternating emphasis, still includes a core/carry block
    // - ab_split: 2 distinct sessions repeated across the week
    // - abc_rotation: 3 distinct sessions repeated across the week
    const dayNames = Array.from({length:days}, (_,i)=>`Day ${i+1}`);
    const baseDosage = dosageForVariant(variant);

    function fullBody(){
      return dayNames.map((d)=>({
        name:d,
        blocks:[
          {title:"Main Lift 1 (Squat pattern)", pattern:"squat"},
          {title:"Main Lift 2 (Hinge pattern)", pattern:"hinge"},
          {title:"Upper Push", pattern:"push"},
          {title:"Upper Pull", pattern:"pull"},
          {title:"Core / Carry", pattern:"carry_core"},
          {title:"Accessory (optional)", pattern:"accessories", optional:true}
        ],
        dosage: baseDosage
      }));
    }

    function upperLower(){
      return dayNames.map((d,i)=>{
        const isUpper = i % 2 === 0;
        return {
          name: `${d} (${isUpper ? "Upper" : "Lower"})`,
          blocks: isUpper ? [
            {title:"Upper Push", pattern:"push"},
            {title:"Upper Pull", pattern:"pull"},
            {title:"Upper Accessory (optional)", pattern:"accessories", optional:true},
            {title:"Core / Carry", pattern:"carry_core"},
          ] : [
            {title:"Squat pattern", pattern:"squat"},
            {title:"Hinge pattern", pattern:"hinge"},
            {title:"Lower Accessory (optional)", pattern:"accessories", optional:true},
            {title:"Core / Carry", pattern:"carry_core"},
          ],
          dosage: baseDosage
        };
      });
    }

    function abSplit(){
      const A = {
        name:"Session A",
        blocks:[
          {title:"Squat pattern", pattern:"squat"},
          {title:"Upper Push", pattern:"push"},
          {title:"Upper Pull", pattern:"pull"},
          {title:"Core / Carry", pattern:"carry_core"},
          {title:"Accessory (optional)", pattern:"accessories", optional:true}
        ],
        dosage: baseDosage
      };
      const B = {
        name:"Session B",
        blocks:[
          {title:"Hinge pattern", pattern:"hinge"},
          {title:"Upper Push (variation)", pattern:"push"},
          {title:"Upper Pull (variation)", pattern:"pull"},
          {title:"Core / Carry", pattern:"carry_core"},
          {title:"Accessory (optional)", pattern:"accessories", optional:true}
        ],
        dosage: baseDosage
      };
      return dayNames.map((d,i)=>{
        const sess = (i % 2 === 0) ? A : B;
        return {...sess, name:`${d} (${sess.name})`};
      });
    }

    function abcRotation(){
      const A = {
        name:"Session A",
        blocks:[
          {title:"Squat pattern", pattern:"squat"},
          {title:"Upper Push", pattern:"push"},
          {title:"Upper Pull", pattern:"pull"},
          {title:"Core / Carry", pattern:"carry_core"},
        ],
        dosage: baseDosage
      };
      const B = {
        name:"Session B",
        blocks:[
          {title:"Hinge pattern", pattern:"hinge"},
          {title:"Upper Push (variation)", pattern:"push"},
          {title:"Upper Pull (variation)", pattern:"pull"},
          {title:"Core / Carry", pattern:"carry_core"},
        ],
        dosage: baseDosage
      };
      const C = {
        name:"Session C",
        blocks:[
          {title:"Lower accessory / pump", pattern:"accessories"},
          {title:"Upper Pull (focus)", pattern:"pull"},
          {title:"Upper Push (focus)", pattern:"push"},
          {title:"Core / Carry", pattern:"carry_core"},
          {title:"Accessory (optional)", pattern:"accessories", optional:true}
        ],
        dosage: baseDosage
      };
      const rot = [A,B,C];
      return dayNames.map((d,i)=>{
        const sess = rot[i % rot.length];
        return {...sess, name:`${d} (${sess.name})`};
      });
    }

    let sessions;
    if(structure === "upper_lower") sessions = upperLower();
    else if(structure === "ab_split") sessions = abSplit();
    else if(structure === "abc_rotation") sessions = abcRotation();
    else sessions = fullBody();

    // Add a short warm-up and a mobility finish for pregnancy/postpartum variants.
    // Keep this low-text and consistent across sessions.
    const addWarmup = (variant.startsWith("pregnancy") || variant.startsWith("postpartum"));
    return sessions.map((s, idx)=>{
      const blocks = [...s.blocks];
      if(addWarmup){
        blocks.unshift({title:"Warm-up (breathing + mobility)", pattern:"carry_core", forced:"90/90 Breathing (rib stack)"});
      }
      // Prioritize more stretching/mobility in 3rd trimester and late pregnancy variants.
      if(variant === "pregnancy_min"){
        blocks.push({title:"Mobility / stretch (finish)", pattern:"accessories", forced:(idx % 2 === 0 ? "Hip Flexor Stretch (supported)" : "Thoracic Opener (side-lying)")});
      } else if(variant === "pregnancy"){
        blocks.push({title:"Optional mobility (finish)", pattern:"accessories", forced:"Cat-Cow (gentle)", optional:true});
      }
      return {...s, blocks};
    });
  }

  function makeTemplateRehab(days){
    const dayNames = Array.from({length:days}, (_,i)=>`Day ${i+1}`);
    return dayNames.map((d)=>({
      name:d,
      blocks:[
        {title:"Breathing + stack", pattern:"carry_core", forced:"Dead Bug (no doming)"},
        {title:"Sit-to-Stand / light squat", pattern:"squat", forced:"Sit-to-Stand (bench)"},
        {title:"Supported row", pattern:"pull"},
        {title:"Glute bridge", pattern:"accessories", forced:"Glute Bridge"},
        {title:"Anti-rotation", pattern:"carry_core", forced:"Pallof Press (anti-rotation)"}
      ],
      dosage:{ main:"2 sets x 6-10 reps @ easy (RIR 6-8)", accessory:"1-2 sets x 8-12 reps @ easy", rest:"as needed" }
    }));
  }

  function dosageForVariant(variant){
    switch(variant){
      case "preconception":
        return { main:"3-5 sets x 3-8 reps", accessory:"2-4 sets x 8-15 reps", rest:"2-3 min main, 60-90s accessory" };
      case "pregnancy":
        return { main:"2-4 sets x 5-10 reps", accessory:"1-3 sets x 8-15 reps", rest:"90-150s main, 60-90s accessory" };
      case "pregnancy_min":
        return { main:"2-3 sets x 6-12 reps", accessory:"1-2 sets x 10-15 reps", rest:"as needed; keep sessions 20–45 min" };
      case "postpartum_recon":
        return { main:"2-4 sets x 6-10 reps", accessory:"1-3 sets x 10-15 reps", rest:"90-150s" };
      case "postpartum_reload":
        return { main:"3-5 sets x 4-8 reps", accessory:"2-4 sets x 8-15 reps", rest:"2-3 min main, 60-120s accessory" };
      case "performance":
        return { main:"3-6 sets x 3-6 reps (plus back-off)", accessory:"2-5 sets x 6-15 reps", rest:"2-4 min main, 60-120s accessory" };
      default:
        return { main:"2-4 sets", accessory:"1-3 sets", rest:"as needed" };
    }
  }

  // --- Modifier Engine (dials)
  // Higher dial = need to reduce that stressor more.
  function computeDials(profile){
    const d = {
      IAP:0, AXIAL:0, ROM:0, ASYM:0, BAL:0, FATIGUE:0, HEMO:0, POSITION:0, GRIP:0, UPRIGHT:0, IMPACT:0, CARRY:0, ISOMETRIC:0, DENSITY:0, FREQ:0
    };

    // stage baseline constraints
    const sk = stageKey(profile);
    if(sk === "t2"){ d.IAP += 1; d.BAL += 1; d.ROM += 1; }
    if(sk === "t3"){ d.IAP += 2; d.BAL += 2; d.ROM += 2; d.AXIAL += 1; d.UPRIGHT += 1; }
    if(sk.startsWith("pp")){ d.IAP += 1; d.FATIGUE += 1; if(profile.stage.breastfeeding) d.FATIGUE += 1; }

    // hard limits
    if(profile.hardLimits.avoidSupine) d.POSITION += 2;
    if(profile.hardLimits.avoidHeavy) { d.IAP += 3; d.AXIAL += 3; d.HEMO += 2; d.FATIGUE += 1; }
    if(profile.hardLimits.avoidImpact) d.IMPACT += 3;
    if(profile.equipment.balanceLimit) d.BAL += 2;

    
    // provider restrictions (if any)
    if(profile.providerRestrictions?.has){
      const tags = profile.providerRestrictions.tags || [];
      if(tags.includes("no_strenuous")){ d.FATIGUE += 3; d.HEMO += 2; d.IAP += 2; d.AXIAL += 2; }
      if(tags.includes("pelvic_rest")){ d.IAP += 4; d.UPRIGHT += 3; d.CARRY += 3; }
      if(tags.includes("no_lift_cap")){ d.IAP += 3; d.AXIAL += 3; d.HEMO += 2; }
      if(tags.includes("hr_cap")){ d.HEMO += 3; d.DENSITY += 2; }
      if(tags.includes("bp_cap")){ d.HEMO += 3; d.IAP += 1; }
      if(tags.includes("bed_rest")){ d.IAP += 10; d.UPRIGHT += 10; d.FATIGUE += 10; d.BEDREST = 1; }
    }

// symptoms severities
    for(const s of SYMPTOMS){
      const entry = profile.symptoms[s.key];
      if(!entry) continue;
      const sev = entry.severity || "none";
      const k = SEVERITY.indexOf(sev);
      if(k <= 0) continue;
      // map affects to dials
      for(const a of s.affects){
        if(a==="IAP") d.IAP += k;
        if(a==="ROM") d.ROM += k;
        if(a==="FATIGUE") d.FATIGUE += k;
        if(a==="ASYM") d.ASYM += k;
        if(a==="BAL") d.BAL += k;
        if(a==="HEMO") d.HEMO += k;
        if(a==="POSITION") d.POSITION += k;
        if(a==="GRIP") d.GRIP += k;
        if(a==="UPRIGHT") d.UPRIGHT += k;
      }
    }

    // diagnoses
    for(const key of profile.diagnoses){
      const dx = DIAGNOSES.find(x=>x.key===key);
      if(!dx) continue;
      for(const [dial,amt] of Object.entries(dx.modifies || {})){
        d[dial] = (d[dial]||0) + amt;
      }
    }

    // lifestyle
    const sleep = profile.lifestyle.sleepHours || 7;
    if(sleep < 6) d.FATIGUE += 2;
    if(profile.lifestyle.stress === "high") d.FATIGUE += 1;

    // normalize to sensible caps
    for(const k of Object.keys(d)){
      d[k] = Math.max(-3, Math.min(10, d[k]));
    }
    return d;
  }

  function equipTags(profile){
    const set = profile.equipment.set;
    if(set === "gym_full") return ["gym_full","barbell","dumbbells"];
    if(set === "barbell") return ["barbell","gym_full"];
    if(set === "home_db") return ["home_db","dumbbells"];
    if(set === "bands_only") return ["bands_only"];
    return ["gym_full"];
  }

  function pickExercise(pattern, profile, dials, forcedName, seed=0){
    // forced overrides
    if(forcedName) return forcedName;

    const options = EXERCISE_LIBRARY[pattern] || [];
    const equip = equipTags(profile);

    // scoring: prefer exercises that reduce constrained dials
    // lower tags value is "easier" on that stressor
    function score(ex){
      const t = ex.tags || {};
      let s = 0;
      // match equipment
      const okEquip = (t.equip || []).some(e=>equip.includes(e));
      if(!okEquip) return -9999;

      // hard exclusions / strong constraints
      if(profile.hardLimits.avoidSupine && t.position==="supine") return -9999;

      // Pregnancy-specific: avoid prone abdominal pressure as pregnancy progresses.
      // 20+ weeks: avoid high abdominal pressure (e.g., prone incline chest-supported row).
      // 28+ weeks: avoid any intentional abdominal pressure.
      if(profile.stage?.mode === "pregnant"){
        const gw = profile.stage.weeksPregnant ?? 0;
        const ap = t.abdomenPressure ?? 0; // 0 none, 1 mild, 2 moderate/high
        if(gw >= 28 && ap >= 1) return -9999;
        if(gw >= 20 && ap >= 2) return -9999;
      }

      // Avoid barbell lifts: hard-exclude barbell-tagged options regardless of equipment access
      if(profile.hardLimits.avoidBarbell && (t.equip || []).includes("barbell")) return -9999;

      // Impact: hard exclude moderate+ impact when user opts out (running/jumping style)
      const impact = t.impact ?? 0; // 0 none, 1 low, 2 moderate, 3 high
      if(profile.hardLimits.avoidImpact && impact >= 2) return -9999;

      // Isometrics: avoid long holds if the isometric constraint is high (HTN/SCH, etc.)
      const iso = t.isometric ?? 0; // 0 none, 1 brief, 2 moderate, 3 sustained
      if(dials.ISOMETRIC >= 4 && iso >= 2) return -9999;

      const highUprightRestriction = (profile.diagnoses.includes("cerclage") || (profile.providerRestrictions?.has && (profile.providerRestrictions.tags||[]).includes("pelvic_rest")));
      if(highUprightRestriction && t.position==="standing") return -9999;

      // soft penalize supine if POSITION dial is elevated (e.g., reflux, late pregnancy)
      if(dials.POSITION >= 2 && t.position==="supine") s -= 4;

      // IAP
      const iap = t.iap ?? 1;
      s -= iap * (dials.IAP/3);

      // axial
      const axial = t.axial ?? 1;
      s -= axial * (dials.AXIAL/3);

      // balance
      const bal = t.balance ?? 1;
      s -= bal * (dials.BAL/3);

      // grip (carpal tunnel)
      const grip = t.grip ?? 1;
      s -= grip * (dials.GRIP/3);

      // upright load (previa/varicose late pregnancy)
      if(t.position==="standing") s -= (dials.UPRIGHT/2.5);

      // carries if restricted
      const carry = t.carry ?? 0;
      s -= carry * (dials.CARRY/3);

      // Impact & isometrics (soft penalties; hard exclusions above handle the highest-risk cases)
      s -= impact * (dials.IMPACT/3);
      s -= iso * (dials.ISOMETRIC/3);

      // bonus for supported/seated when constraints high
      if(["seated","supported","incline","side"].includes(t.position)) s += (dials.BAL + dials.IAP + dials.UPRIGHT)/12;

      return s;
    }

    // Build ranked list.
    const ranked = options
      .map(ex => ({ ex, sc: score(ex) }))
      .filter(x => x.sc > -9990)
      .sort((a,b) => b.sc - a.sc);

    if(!ranked.length) return options[0]?.name || "—";

    const bestScore = ranked[0].sc;
    // Allow some variety by selecting among near-best options.
    // Threshold is small so we don't pick unsafe/worse options under constraints.
    const threshold = 0.75;
    const pool = ranked.filter(x => (bestScore - x.sc) <= threshold);
    const idx = ((seed % pool.length) + pool.length) % pool.length;
    return pool[idx].ex.name;
  }

  function adjustDosage(baseDosage, profile, dials, templateMeta){
    // outputs: sets/reps/rest + constraints guidance
    // Use dials to adjust: intensity, RIR, density, session length guidance
    let intensity = templateMeta.intensityBand;
    let rirMain = templateMeta.rir.main;
    let rirAcc = templateMeta.rir.accessory;

    const notes = [];

    // IAP/HEMO high -> more conservative
    if(dials.IAP >= 5 || dials.HEMO >= 5){
      intensity = "low";
      rirMain = "4-6";
      rirAcc = "5-7";
      notes.push("Keep breathing continuous; no breath holds or grinders.");
    }
    if(dials.FATIGUE >= 6){
      notes.push("Reduce total sets by ~25–40% this week; prioritize main patterns.");
    }
    if(dials.BAL >= 5){
      notes.push("Prefer machines/seated/supported variants; avoid unstable setups.");
    }
    if(profile.stage.mode==="pregnant" && stageKey(profile)==="t3"){
      notes.push("Keep sessions 20–45 min; stop 1–2 reps earlier than you think you need to.");
    }
    if(profile.diagnoses.includes("gdm")){
      notes.push("Short post-meal sessions (10–20 min) are a high-value add for glucose control.");
    }
    if(profile.diagnoses.includes("sch") || profile.diagnoses.includes("previa")){
      notes.push("Avoid impact and high IAP; treat training as submaximal skill + circulation.");
    }
    if(dials.IMPACT >= 4 || profile.hardLimits.avoidImpact){
      notes.push("Keep work low-impact: no jumping/running; favor controlled strength movements.");
    }
    if(dials.ISOMETRIC >= 4){
      notes.push("Limit long isometric holds; use dynamic reps with continuous breathing.");
    }
    if(profile.diagnoses.includes("cerclage")){
      notes.push("High-risk profile: keep work seated/supported only and follow clinician restrictions.");
    }

    // density adjustments
    let rest = baseDosage.rest;
    // Positive DENSITY means: avoid dense circuits (needs more rest).
    if(dials.DENSITY >= 2 || dials.FATIGUE >= 6) rest = "increase rest; avoid circuits";
    // Negative DENSITY means: can tolerate slightly denser work (useful for GDM).
    if(dials.DENSITY <= -1 && dials.FATIGUE <= 4) rest = "60–120s; gentle circuits acceptable (not exhausting)";
    // User difficulty preference: conservative, stage-appropriate nudges.
    const pref = profile.difficulty?.preference || "standard";
    if(pref === "slightly_harder"){
      notes.push("You marked workouts as a bit too easy: if symptoms are stable, add 1 set to the first 1–2 main lifts OR add 1 accessory set.");
      // Slightly more challenging guidance: nudge intensity band up one step if very low.
      if(intensity === "very_low") intensity = "low";
      // Slightly reduce RIR targets (still pregnancy-safe).
      rirMain = bumpRIRDown(rirMain, 1);
      rirAcc = bumpRIRDown(rirAcc, 1);
    }
    if(pref === "much_harder"){
      notes.push("You asked for a harder plan: prioritize perfect technique and symptom-free work. If stable for 2 weeks, add 1 set on most lifts and progress load slowly.");
      if(intensity === "very_low") intensity = "low";
      if(intensity === "low") intensity = "low_to_moderate";
      rirMain = bumpRIRDown(rirMain, 2);
      rirAcc = bumpRIRDown(rirAcc, 1);
    }

    // Adaptive progression/regression from weekly check-ins.
    const prog = profile._prog || null;
    if(prog?.regress){
      notes.push("Auto-adjust: hold/regress this week (symptoms flagged last week). Reduce load 10–20% and prioritize breathing & control.");
      rirMain = bumpRIRUp(rirMain, 1);
      rirAcc = bumpRIRUp(rirAcc, 1);
    } else if(prog?.progressStep){
      const s = Math.min(3, Math.max(1, Number(prog.progressStep||1)));
      notes.push(`Auto-adjust: progressive week (+${s} step). If symptom-free, add 1 set to 1–2 key lifts OR add a small load bump (1–2%).`);
      rirMain = bumpRIRDown(rirMain, Math.min(1,s));
    }

    // GDM extra note already above
    return { intensity, rirMain, rirAcc, base: baseDosage, rest, notes };
  }

  function bumpRIRDown(rirStr, by){
    // rirStr format: "a-b". Decrease both ends by 'by', clamped to >=0.
    const m = String(rirStr||"").match(/(\d+)\s*-\s*(\d+)/);
    if(!m) return rirStr;
    const a = Math.max(0, Number(m[1]) - by);
    const b = Math.max(0, Number(m[2]) - by);
    return `${a}-${b}`;
  }

  function bumpRIRUp(rirStr, by){
    const m = String(rirStr||"").match(/(\d+)\s*-\s*(\d+)/);
    if(!m) return rirStr;
    const a = Math.max(0, Number(m[1]) + by);
    const b = Math.max(a, Number(m[2]) + by);
    return `${a}-${b}`;
  }

  // Generate a single-week plan for a given (possibly time-shifted) profile.
  function generateWeekPlan(profile, weekSeed=0){
    const sk = stageKey(profile);
    const templateMeta = BASE_TEMPLATES[sk];
    const days = Math.max(1, Math.min(6, profile.schedule.daysPerWeek || templateMeta.defaultDays));
    const dials = computeDials(profile);

    if(dials.BEDREST){
      return {
        template: templateMeta.name,
        stageKey: sk,
        dials,
        dosage: { intensity:"very_low", rirMain:"8-10", rirAcc:"8-10", base:{main:"Breathing + gentle mobility only", accessory:"—", rest:"as needed"}, rest:"as needed", notes:[
          "Bed rest / limited activity selected: follow clinician restrictions as primary constraint.",
          "Use only clinician-approved movement (often breathing, gentle mobility, short walks if cleared)."
        ]},
        sessions: [{
          name:"Clinician-restricted day",
          dosage:{main:"Breathing + mobility only", accessory:"—", rest:"as needed"},
          blocks:[
            {title:"Breathing (stack + relaxation)", pattern:"carry_core", exercise:"90/90 Breathing (rib stack)", optional:false},
            {title:"Gentle mobility", pattern:"accessories", exercise:"Cat-Cow (gentle)", optional:false},
          ]
        }],
        warnings:["Bed rest / limited activity is selected. This app cannot prescribe training. Use medical guidance first."]
      };
    }

    const sessions = templateMeta.sessions(days, profile).map((sess, dayIdx)=>{
      const blocks = sess.blocks.map((b, blockIdx)=>{
        const forced = b.forced || null;
        // Seed adds controlled variety across days + weeks while still honoring constraints.
        const seed = (weekSeed * 100) + (dayIdx * 10) + blockIdx;
        const ex = pickExercise(b.pattern, profile, dials, forced, seed);
        return { title:b.title, pattern:b.pattern, exercise: ex, optional: !!b.optional };
      });

      return { name:sess.name, dosage:sess.dosage, blocks };
    });

    const dosageAdj = adjustDosage(sessions[0]?.dosage || {}, profile, dials, templateMeta);

    // session minutes constraint: trim optional accessories if needed
    const minutes = profile.schedule.sessionMinutes || 30;
    const trimmed = sessions.map(s=>{
      const newBlocks = [...s.blocks];
      if(minutes <= 20){
        return {...s, blocks:newBlocks.filter(b=>!b.optional).slice(0,5)};
      }
      if(minutes <= 30){
        return {...s, blocks:newBlocks.filter(b=>!b.optional || b.pattern!=="accessories")};
      }
      return s;
    });

    // warnings
    const warnings = [];
    const redDx = profile.diagnoses.some(k => (DIAGNOSES.find(d=>d.key===k)?.class==="red"));
    if(redDx) warnings.push("Your selections include a higher-risk condition. Use clinician restrictions as primary constraint; consider pelvic/OB clearance before resistance work.");

    return {
      template: templateMeta.name,
      stageKey: sk,
      dials,
      dosage: dosageAdj,
      sessions: trimmed,
      warnings
    };
  }

  // Generate a multi-week plan that progresses to due date (if provided), and then postpartum for a user-selected duration.
  function generatePlan(profile){
    const createdAt = new Date().toISOString();
    const id = "plan_" + Date.now();

    const weeks = [];
    const now = new Date();

    function addWeek(label, tempProfile, weekSeed){
      // Store a full snapshot so we can regenerate adaptively based on weekly check-ins.
      const snap = deepClone(tempProfile);
      const weekPlan = generateWeekPlan(tempProfile, weekSeed);
      weeks.push({ label, startDate: labelStartDate(now, weekSeed), stageSnapshot: snapshotStage(tempProfile), profileSnapshot: snap, weekSeed, ...weekPlan });
    }

    // Pregnant mode: build pregnancy weeks until due date (if set), else default to 4 weeks.
    if(profile.stage.mode === "pregnant"){
      const due = profile.stage.dueDate ? new Date(profile.stage.dueDate) : null;
      let pregWeeksCount = 4;
      if(due && !isNaN(due.getTime())){
        const diffDays = Math.max(0, Math.ceil((due.getTime() - now.getTime()) / (1000*60*60*24)));
        pregWeeksCount = Math.max(1, Math.ceil(diffDays / 7));
      }
      for(let i=0; i<pregWeeksCount; i++){
        const tp = deepClone(profile);
        tp.stage.weeksPregnant = (profile.stage.weeksPregnant || 0) + i;
        addWeek(`Pregnancy – Week ${tp.stage.weeksPregnant}`, tp, i);
      }

      // Add postpartum block if due date present and postpartumPlanWeeks > 0
      const ppWeeks = Math.max(0, Math.min(104, Number(profile.stage.postpartumPlanWeeks || 0)));
      if(due && !isNaN(due.getTime()) && ppWeeks > 0){
        for(let j=0; j<ppWeeks; j++){
          const tp = deepClone(profile);
          tp.stage.mode = "postpartum";
          tp.stage.weeksPostpartum = j;
          addWeek(`Postpartum – Week ${j+1}`, tp, pregWeeksCount + j);
        }
      }
    }

    // Postpartum mode: generate from current weeks postpartum to requested horizon.
    if(profile.stage.mode === "postpartum"){
      const start = Number(profile.stage.weeksPostpartum || 0);
      const ppWeeks = Math.max(1, Math.min(104, Number(profile.stage.postpartumPlanWeeks || 24)));
      for(let j=0; j<ppWeeks; j++){
        const tp = deepClone(profile);
        tp.stage.weeksPostpartum = start + j;
        addWeek(`Postpartum – Week ${tp.stage.weeksPostpartum+1}`, tp, j);
      }
    }

    // Preconception mode: generate a 12-week progressive block by default (or 8 if user wants shorter later).
    if(profile.stage.mode === "preconception"){
      const count = 12;
      for(let i=0; i<count; i++){
        const tp = deepClone(profile);
        addWeek(`Preconception – Week ${i+1}`, tp, i);
      }
    }

    const warnings = [].concat(...weeks.map(w => w.warnings || [])).filter((v,i,a)=>a.indexOf(v)===i);

    return { id, createdAt, weeks, warnings };
  }

  function snapshotStage(profile){
    const s = profile.stage || {};
    return { mode:s.mode, weeksPregnant:s.weeksPregnant, weeksPostpartum:s.weeksPostpartum, dueDate:s.dueDate, postpartumPlanWeeks:s.postpartumPlanWeeks };
  }

  function labelStartDate(now, seed){
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + seed*7);
    return d.toISOString().slice(0,10);
  }

  function deepClone(obj){
    return JSON.parse(JSON.stringify(obj));
  }

  // --- Persistence
  const LS_KEY = "nurturestrength_saved_plans_v1";
  const LS_LOGS = "nurturestrength_workout_logs_v1";
  const LS_CHECKINS = "nurturestrength_week_checkins_v1";
  function loadSaved(){
    try{ return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }catch(e){ return []; }
  }
  function saveSaved(arr){
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
  }

  function loadLogs(){
    try{ return JSON.parse(localStorage.getItem(LS_LOGS) || "[]"); }catch(e){ return []; }
  }
  function saveLogs(arr){
    localStorage.setItem(LS_LOGS, JSON.stringify(arr));
  }

  function loadCheckins(){
    try{ return JSON.parse(localStorage.getItem(LS_CHECKINS) || "[]"); }catch(e){ return []; }
  }
  function saveCheckins(arr){
    localStorage.setItem(LS_CHECKINS, JSON.stringify(arr));
  }
  function getCheckin(planId, weekIndex){
    const all = loadCheckins();
    return all.find(c=>c.planId===planId && c.weekIndex===weekIndex) || null;
  }
  function upsertCheckin(entry){
    const all = loadCheckins();
    const i = all.findIndex(c=>c.planId===entry.planId && c.weekIndex===entry.weekIndex);
    if(i>=0) all[i] = entry; else all.unshift(entry);
    saveCheckins(all);
  }
  function todayKey(){
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // --- UI Rendering
  function route(to){
    if(!ROUTES.includes(to)) to = "workout";
    state.route = to;
    render();
  }

  function render(){
    const root = $("#app");
    if(!root) return;
    root.innerHTML = "";
    $$(".nav-btn").forEach(b=>{
      b.classList.toggle("primary", b.dataset.route === state.route);
      b.onclick = ()=> route(b.dataset.route);
    });

    if(state.route === "workout") root.appendChild(renderWorkout());
    if(state.route === "profile") root.appendChild(renderProfileSummary());
    if(state.route === "setup") root.appendChild(renderSetup());
    if(state.route === "history") root.appendChild(renderHistory());
    if(state.route === "about") root.appendChild(renderAbout());
  }

  // --- Profile summary (high-level, low-text)
  function renderProfileSummary(){
    const p = state.profile;
    const sk = stageKey(p);
    const cont = div("panel");
    cont.appendChild(el("h1",{},["Profile"]));

    const summary = div("grid2");
    summary.appendChild(card("Stage", stageSummaryText(p)));
    summary.appendChild(card("Program", `${programStyleLabel(p.schedule.style)} • ${p.schedule.daysPerWeek} days/week • ${p.schedule.sessionMinutes} min`));
    summary.appendChild(card("Equipment", equipmentLabel(p.equipment.set)));
    summary.appendChild(card("Goals", goalLabels(p.goals).join(" • ")));
    cont.appendChild(summary);

    // Quick controls
    const quick = div("panel");
    quick.appendChild(el("h2",{},["Quick updates"]));
    quick.appendChild(el("div",{class:"row"},[
      el("label",{},["Week of pregnancy/postpartum"]),
      stageWeekQuickEditor(p)
    ]));
    quick.appendChild(el("div",{class:"row"},[
      el("label",{},["If workouts feel too easy (optional)"]),
      selectInput(p.difficulty.preference,[
        {v:"standard",t:"Standard"},
        {v:"slightly_harder",t:"Slightly harder"},
        {v:"much_harder",t:"Much harder"},
      ], (v)=>{ p.difficulty.preference=v; render(); })
    ]));
    quick.appendChild(el("div",{class:"row"},[
      el("label",{},["Notes (what you'd like adjusted)"]),
      textareaInput(p.difficulty.notes, (v)=>{ p.difficulty.notes=v; })
    ]));
    cont.appendChild(quick);

    const actions = div("btnrow");
    const edit = el("button",{class:"btn primary",type:"button"},["Edit setup questionnaire"]);
    edit.onclick = ()=>{ state.route="setup"; render(); };
    const gen = el("button",{class:"btn",type:"button"},["Generate / refresh plan"]);
    gen.onclick = ()=>{ state.generatedPlan = generatePlan(state.profile); state.activeWeekIndex=0; state.route="workout"; render(); };
    actions.appendChild(edit);
    actions.appendChild(gen);
    cont.appendChild(actions);

    // Light diagnostic: show key constraints in collapsible section
    const details = el("details",{class:"details"},[
      el("summary",{},["View constraints & safety notes"]),
      renderConstraintsSnapshot(p)
    ]);
    cont.appendChild(details);
    return cont;
  }

  // --- Setup page: all questions in one place, split into collapsible sections
  function renderSetup(){
    const p = state.profile;
    const container = div("panel");
    container.appendChild(el("h1",{},["Setup questionnaire"]));
    container.appendChild(el("p",{class:"muted"},["Everything is here in one place. Open only the sections you need."]));

    const sections = div();
    sections.appendChild(sectionDetails("Safety & provider restrictions", stepSafety()));
    sections.appendChild(sectionDetails("Stage", stepStage()));
    sections.appendChild(sectionDetails("Schedule", stepSchedule()));
    sections.appendChild(sectionDetails("Equipment", stepEquipment()));
    sections.appendChild(sectionDetails("Training background", stepTraining()));
    sections.appendChild(sectionDetails("Issues & limitations", stepIssues()));
    sections.appendChild(sectionDetails("Goals & lifestyle", stepGoals()));
    container.appendChild(sections);

    const actions = div("btnrow");
    const back = el("button",{class:"btn",type:"button"},["Back to profile"]);
    back.onclick = ()=>{ state.route="profile"; render(); };
    const gen = el("button",{class:"btn primary",type:"button"},["Generate / refresh plan"]);
    gen.onclick = ()=>{ state.generatedPlan = generatePlan(state.profile); state.activeWeekIndex=0; state.route="workout"; render(); };
    actions.appendChild(back);
    actions.appendChild(gen);
    container.appendChild(actions);
    return container;
  }

  // --- (Legacy) Wizard kept for reference but no longer routed.
  function renderWizard(){
    const p = state.profile;

    const steps = [
      {title:"Safety & clearance", el: stepSafety()},
      {title:"Stage", el: stepStage()},
      {title:"Schedule", el: stepSchedule()},
      {title:"Equipment", el: stepEquipment()},
      {title:"Training background", el: stepTraining()},
      {title:"Issues & limitations", el: stepIssues()},
      {title:"Goals & lifestyle", el: stepGoals()},
      {title:"Review & generate", el: stepReview()},
    ];

    const container = div("panel");
    const head = div("hrow");
    head.appendChild(el("div", {}, [
      el("h1", {}, ["Create your plan"]),
      el("p", {}, ["Answer a few questions. The plan adapts using stage + constraints + symptoms. Use dropdowns/collapsibles to avoid endless scrolling."])
    ]));
    const badge = el("span",{class:"badge"},[`Step ${state.wizardStep+1} / ${steps.length}`]);
    head.appendChild(badge);
    container.appendChild(head);

    // progress
    const prog = div("progress");
    const bar = div();
    bar.style.width = Math.round(((state.wizardStep+1)/steps.length)*100) + "%";
    prog.appendChild(bar);
    container.appendChild(prog);

    container.appendChild(el("hr"));

    // accordion-like step selector
    const stepNav = div("chips");
    steps.forEach((s,i)=>{
      const b = el("button", {class:"btn", type:"button"}, [s.title]);
      if(i===state.wizardStep) b.classList.add("primary");
      b.onclick = ()=>{ state.wizardStep=i; render(); };
      stepNav.appendChild(b);
    });
    container.appendChild(stepNav);

    // step content
    const stepPanel = div("panel");
    stepPanel.appendChild(el("h2", {}, [steps[state.wizardStep].title]));
    stepPanel.appendChild(steps[state.wizardStep].el);
    container.appendChild(stepPanel);

    // footer buttons
    const btns = div("btnrow");
    const back = el("button",{class:"btn", type:"button"},["Back"]);
    back.disabled = state.wizardStep===0;
    back.onclick = ()=>{ state.wizardStep=Math.max(0,state.wizardStep-1); render(); };

    const next = el("button",{class:"btn primary", type:"button"},[state.wizardStep===steps.length-1 ? "Generate plan" : "Next"]);
    next.onclick = ()=>{
      if(state.wizardStep===steps.length-1){
        state.generatedPlan = generatePlan(state.profile);
        state.activeWeekIndex = 0;
        state.route = "workout";
        render();
      } else {
        state.wizardStep = Math.min(steps.length-1, state.wizardStep+1);
        render();
      }
    };
    btns.appendChild(back);
    btns.appendChild(next);
    container.appendChild(btns);

    return container;
  }

  // --- Step builders (dropdown-heavy + collapsibles)
  function stepSafety(){
    const p = state.profile;
    const wrap = div();
    wrap.appendChild(fieldCheckbox("I acknowledge this is educational and I will follow clinician restrictions.", p.clearanceAcknowledged, v=>p.clearanceAcknowledged=v));

    wrap.appendChild(el("hr"));

    const has = p.providerRestrictions.has;
    wrap.appendChild(fieldSelect("Any provider restrictions to follow?", has ? "yes":"no", [
      ["no","No"],["yes","Yes"]
    ], v=>{ p.providerRestrictions.has = (v==="yes"); render(); }, "Use this if your clinician gave specific restrictions."));
    if(p.providerRestrictions.has){
      wrap.appendChild(el("div",{class:"grid"},[
        el("div",{class:"field col-6"},[
          el("label",{},["Restriction tags"]),
          el("select",{multiple:true, size:5, onchange:(e)=>{
            p.providerRestrictions.tags = Array.from(e.target.selectedOptions).map(o=>o.value);
          }},[
            opt("pelvic_rest","Pelvic rest", (p.providerRestrictions.tags||[]).includes("pelvic_rest")),
            opt("no_strenuous","No strenuous exercise", (p.providerRestrictions.tags||[]).includes("no_strenuous")),
            opt("no_lift_cap","No lifting above a cap", (p.providerRestrictions.tags||[]).includes("no_lift_cap")),
            opt("hr_cap","Heart rate cap", (p.providerRestrictions.tags||[]).includes("hr_cap")),
            opt("bp_cap","Blood pressure cap", (p.providerRestrictions.tags||[]).includes("bp_cap")),
            opt("bed_rest","Bed rest / limited activity", (p.providerRestrictions.tags||[]).includes("bed_rest")),
          ]),
          el("div",{class:"help"},["Tip: hold ", el("span",{class:"kbd"},["Ctrl/⌘"]), " to select multiple."])
        ]),
        el("div",{class:"field col-6"},[
          el("label",{},["Notes (optional)"]),
          el("textarea",{value:p.providerRestrictions.notes, oninput:(e)=>p.providerRestrictions.notes=e.target.value, placeholder:"e.g., No lifting > 20 lb; avoid standing long periods; pelvic rest until bleeding resolves."})
        ])
      ]));
    }
    return wrap;
  }

  function stepStage(){
    const p = state.profile;
    const wrap = div();

    wrap.appendChild(fieldSelect("Which stage are you in?", p.stage.mode, [
      ["preconception","Trying to conceive / Preconception"],
      ["pregnant","Pregnant"],
      ["postpartum","Postpartum"]
    ], v=>{ p.stage.mode=v; render(); }));

    if(p.stage.mode==="pregnant"){
      wrap.appendChild(fieldRange("Weeks pregnant", p.stage.weeksPregnant, 0, 42, 1, v=>p.stage.weeksPregnant=v, "Used to set trimester-specific programming + position adjustments."));
      wrap.appendChild(el("div",{class:"grid"},[
        el("div",{class:"field col-6"},[
          el("label",{},["Due date (optional)"]),
          el("input",{type:"date", value:p.stage.dueDate || "", onchange:(e)=>p.stage.dueDate=e.target.value}),
          el("div",{class:"help"},["If set, the program auto-builds week-by-week until due date."])
        ]),
        el("div",{class:"field col-6"},[
          el("label",{},["Postpartum plan length"]),
          el("select",{value:String(p.stage.postpartumPlanWeeks||24), onchange:(e)=>p.stage.postpartumPlanWeeks=parseInt(e.target.value,10)},[
            opt("0","No postpartum plan"),opt("6","6 weeks"),opt("12","12 weeks"),opt("24","24 weeks"),opt("52","52 weeks"),opt("104","104 weeks")
          ]),
          el("div",{class:"help"},["How long you want the app to generate postpartum programming after birth."])
        ])
      ]));
    } else if(p.stage.mode==="postpartum"){
      wrap.appendChild(fieldRange("Weeks postpartum", p.stage.weeksPostpartum, 0, 156, 1, v=>p.stage.weeksPostpartum=v, "Used to set tissue tolerance + return-to-load pace."));
      wrap.appendChild(el("div",{class:"field"},[
        el("label",{},["How many future postpartum weeks to generate?"]),
        el("select",{value:String(p.stage.postpartumPlanWeeks||24), onchange:(e)=>p.stage.postpartumPlanWeeks=parseInt(e.target.value,10)},[
          opt("4","4 weeks"),opt("8","8 weeks"),opt("12","12 weeks"),opt("24","24 weeks"),opt("52","52 weeks"),opt("104","104 weeks")
        ])
      ]));
      wrap.appendChild(fieldSelect("Delivery type", p.stage.deliveryType, [
        ["vaginal","Vaginal"],["c_section","C-section"],["assisted","Assisted (vacuum/forceps)"],["vbac","VBAC"]
      ], v=>p.stage.deliveryType=v));
      wrap.appendChild(fieldSelect("Breastfeeding?", p.stage.breastfeeding ? "yes":"no", [["no","No"],["yes","Yes"]], v=>p.stage.breastfeeding=(v==="yes"),
        "Breastfeeding can reduce estrogen and affect tendon/ligament recovery; the app is more conservative."));
    }

    return wrap;
  }

  function stepSchedule(){
    const p = state.profile;
    const wrap = div();
    wrap.appendChild(el("div",{class:"grid"},[
      el("div",{class:"field col-6"},[
        el("label",{},["Days per week"]),
        el("select",{value:String(p.schedule.daysPerWeek), onchange:(e)=>p.schedule.daysPerWeek=parseInt(e.target.value,10)},[
          opt("1","1"),opt("2","2"),opt("3","3"),opt("4","4"),opt("5","5"),opt("6","6")
        ])
      ]),
      el("div",{class:"field col-6"},[
        el("label",{},["Session length"]),
        el("select",{value:String(p.schedule.sessionMinutes), onchange:(e)=>p.schedule.sessionMinutes=parseInt(e.target.value,10)},[
          opt("15","15 min"),opt("20","20 min"),opt("30","30 min"),opt("45","45 min"),opt("60","60 min")
        ]),
        el("div",{class:"help"},["The plan trims optional accessories automatically for shorter sessions."])
      ]),
      el("div",{class:"field col-6"},[
        el("label",{},["Preferred style"]),
        el("select",{value:p.schedule.style, onchange:(e)=>p.schedule.style=e.target.value},[
          opt("full_body","Full-body"),
          opt("upper_lower","Upper/Lower alternating"),
          opt("ab_split","2-day A/B split"),
          opt("abc_rotation","3-day A/B/C rotation")
        ])
      ]),
      el("div",{class:"field col-6"},[
        el("label",{},["Coaching tone"]),
        el("select",{value:p.tone, onchange:(e)=>p.tone=e.target.value},[
          opt("gentle","Gentle"),opt("direct","Direct"),opt("coach","Coach me hard")
        ])
      ]),
    ]));
    return wrap;
  }

  function stepEquipment(){
    const p = state.profile;
    const wrap = div();

    wrap.appendChild(el("div",{class:"grid"},[
      el("div",{class:"field col-6"},[
        el("label",{},["Equipment access"]),
        el("select",{value:p.equipment.set, onchange:(e)=>{p.equipment.set=e.target.value; render();}},[
          opt("gym_full","Full gym access"),
          opt("home_db","Home dumbbells"),
          opt("bands_only","Bands only"),
          opt("barbell","Barbell setup"),
        ])
      ]),
      el("div",{class:"field col-6"},[
        el("label",{},["Cardio option (optional)"]),
        el("select",{value:p.equipment.cardio, onchange:(e)=>p.equipment.cardio=e.target.value},[
          opt("walking","Walking"),
          opt("bike","Bike"),
          opt("rower","Rower"),
          opt("treadmill","Treadmill"),
          opt("none","None"),
        ])
      ]),
      el("div",{class:"field col-12"},[
        el("label",{},["Balance limitations / fall risk?"]),
        el("select",{value:p.equipment.balanceLimit ? "yes":"no", onchange:(e)=>{p.equipment.balanceLimit=(e.target.value==="yes");}},[
          opt("no","No"),opt("yes","Yes")
        ]),
        el("div",{class:"help"},["If yes, the plan prefers seated/supported exercises and avoids unstable setups."])
      ]),
    ]));

    return wrap;
  }

  function stepTraining(){
    const p = state.profile;
    const wrap = div();

    wrap.appendChild(fieldSelect("Training experience", p.training.experience, [
      ["beginner","Beginner"],["intermediate","Intermediate"],["advanced","Advanced"]
    ], v=>p.training.experience=v));

    const confKeys = ["squat","hinge","push","pull","carry"];
    wrap.appendChild(el("div",{class:"grid"}, confKeys.map(k=>(
      el("div",{class:"field col-4"},[
        el("label",{},[k.toUpperCase()+" confidence"]),
        el("select",{value:p.training.confidence[k], onchange:(e)=>p.training.confidence[k]=e.target.value},[
          opt("confident","Confident"),opt("unsure","Unsure"),opt("avoid","Avoid")
        ])
      ])
    ))));

    wrap.appendChild(el("hr"));

    const injuryOpts = ["low_back","knee","shoulder","hip","pelvic_floor","other"];
    wrap.appendChild(el("div",{class:"field"},[
      el("label",{},["Past injuries (optional)"]),
      el("select",{multiple:true, size:6, onchange:(e)=>{p.training.injuries = Array.from(e.target.selectedOptions).map(o=>o.value);}}, injuryOpts.map(v=>opt(v, pretty(v), (p.training.injuries||[]).includes(v)))),
      el("div",{class:"help"},["This MVP stores injuries; next iteration can add injury-specific substitutions."])
    ]));

    return wrap;
  }

  function stepIssues(){
    const p = state.profile;
    const wrap = div();

    // Use collapsibles to reduce scroll
    const detA = el("details", {open:true}, [
      el("summary", {}, ["Symptoms (pick severity)", el("span",{class:"summary-note"},["dropdowns keep this compact"])])
    ]);
    const chips = div("chips");

    SYMPTOMS.forEach(s=>{
      const chip = div("chip");
      const cb = el("input", {type:"checkbox", checked: !!p.symptoms[s.key], onchange:(e)=>{
        if(e.target.checked){
          p.symptoms[s.key] = { severity:"mild", worsensWithExercise:"unsure" };
        } else {
          delete p.symptoms[s.key];
        }
        render();
      }});
      chip.appendChild(cb);
      chip.appendChild(el("strong",{},[s.label]));
      if(p.symptoms[s.key]){
        const sel = el("select",{value:p.symptoms[s.key].severity, onchange:(e)=>{p.symptoms[s.key].severity=e.target.value;}}, SEVERITY.map(v=>opt(v, pretty(v))));
        const trig = el("select",{value:p.symptoms[s.key].worsensWithExercise, onchange:(e)=>{p.symptoms[s.key].worsensWithExercise=e.target.value;}}, [
          opt("no","Does not worsen"), opt("yes","Worsens with exercise"), opt("unsure","Unsure")
        ]);
        chip.appendChild(sel);
        chip.appendChild(trig);
      }
      chips.appendChild(chip);
    });
    detA.appendChild(chips);
    wrap.appendChild(detA);

    const detB = el("details", {open:false}, [
      el("summary", {}, ["Diagnoses (medical)", el("span",{class:"summary-note"},["drives modifiers + warnings"])])
    ]);
    const dxWrap = div("chips");
    DIAGNOSES.forEach(d=>{
      const chip = div("chip");
      const cb = el("input",{type:"checkbox", checked: p.diagnoses.includes(d.key), onchange:(e)=>{
        if(e.target.checked){
          if(!p.diagnoses.includes(d.key)) p.diagnoses.push(d.key);
        }else{
          p.diagnoses = p.diagnoses.filter(x=>x!==d.key);
        }
        render();
      }});
      chip.appendChild(cb);
      chip.appendChild(el("strong",{},[d.label]));
      dxWrap.appendChild(chip);
    });
    detB.appendChild(dxWrap);
    detB.appendChild(el("p",{},["If you have provider instructions, enter them on Step 1. The plan will also show a caution banner for higher-risk conditions."]));
    wrap.appendChild(detB);

    const detC = el("details", {open:false}, [
      el("summary", {}, ["Hard limits & stop rules", el("span",{class:"summary-note"},["quick toggles"])])
    ]);
    detC.appendChild(el("div",{class:"grid"},[
      checkboxField("Avoid supine exercises", p.hardLimits.avoidSupine, v=>p.hardLimits.avoidSupine=v, "Useful for reflux or late pregnancy discomfort."),
      checkboxField("Avoid heavy lifting", p.hardLimits.avoidHeavy, v=>p.hardLimits.avoidHeavy=v),
      checkboxField("Avoid impact/plyometrics", p.hardLimits.avoidImpact, v=>p.hardLimits.avoidImpact=v),
      checkboxField("Avoid barbell lifts", p.hardLimits.avoidBarbell, v=>p.hardLimits.avoidBarbell=v),
      checkboxField("Avoid running", p.hardLimits.avoidRunning, v=>p.hardLimits.avoidRunning=v),
      el("div",{class:"field col-6"},[
        el("label",{},["Pain stop rule"]),
        el("select",{value:String(p.hardLimits.painStopAt), onchange:(e)=>p.hardLimits.painStopAt=parseInt(e.target.value,10)},[
          opt("2","Stop at 2/10"), opt("4","Stop at 4/10"), opt("6","Stop at 6/10")
        ]),
      ]),
      checkboxField("Stop if leakage occurs", p.hardLimits.stopOnLeakage, v=>p.hardLimits.stopOnLeakage=v),
      checkboxField("Stop if pelvic heaviness occurs", p.hardLimits.stopOnHeaviness, v=>p.hardLimits.stopOnHeaviness=v),
      checkboxField("Stop if doming occurs", p.hardLimits.stopOnDoming, v=>p.hardLimits.stopOnDoming=v),
    ]));
    wrap.appendChild(detC);

    return wrap;
  }

  function checkboxField(label, val, onChange, help){
    return el("div",{class:"field col-6"},[
      el("label",{},[label]),
      el("select",{value: val ? "yes":"no", onchange:(e)=>onChange(e.target.value==="yes")},[
        opt("no","No", !val), opt("yes","Yes", val)
      ]),
      help ? el("div",{class:"help"},[help]) : null
    ].filter(Boolean));
  }

  function stepGoals(){
    const p = state.profile;
    const wrap = div();

    const goalOpts = [
      ["maintain_strength","Maintain strength"],
      ["build_muscle","Build muscle (where possible)"],
      ["reduce_pain","Reduce pain / feel better"],
      ["prepare_delivery","Prepare for delivery"],
      ["return_heavy","Return to heavy lifting postpartum"],
      ["return_run","Return to running/sport"],
      ["glucose_control","Improve glucose control (GDM)"],
      ["posture_endurance","Posture/upper back endurance"],
    ];

    // Compact goal picker: dropdown menu with checkboxes (max 2) + auto-populated summary.
    const goalMap = Object.fromEntries(goalOpts);
    const goalPicker = el("details", {class:"dropdown", open:false}, [
      el("summary", {class:"dropdown-summary"}, [
        el("div", {class:"field"}, [
          el("label",{},["Choose your top goals (pick up to 2)"]),
          el("div", {class:"selectlike"}, [
            el("span", {id:"goalSummary"}, [ (p.goals||[]).length ? (p.goals.map(g=>goalMap[g]||g).join(" • ")) : "Select up to 2 goals" ])
          ]),
          el("div",{class:"help"},["Click to open. Selecting a 3rd goal will be blocked."])
        ])
      ])
    ]);
    const menu = div("dropdown-menu");
    goalOpts.forEach(([v,l])=>{
      const row = div("dropdown-row");
      const cb = el("input", {type:"checkbox", checked:(p.goals||[]).includes(v), onchange:(e)=>{
        const cur = new Set(p.goals||[]);
        if(e.target.checked){
          if(cur.size >= 2){
            e.target.checked = false;
            alert("You can choose up to 2 goals.");
            return;
          }
          cur.add(v);
        } else {
          cur.delete(v);
        }
        p.goals = Array.from(cur);
        // update summary text without full re-render
        const sum = document.getElementById("goalSummary");
        if(sum) sum.textContent = p.goals.length ? p.goals.map(g=>goalMap[g]||g).join(" • ") : "Select up to 2 goals";
      }});
      row.appendChild(cb);
      row.appendChild(el("span",{},[l]));
      menu.appendChild(row);
    });
    goalPicker.appendChild(menu);
    wrap.appendChild(goalPicker);

    wrap.appendChild(el("hr"));

    // Lifestyle modifiers (dropdowns)
    wrap.appendChild(el("div",{class:"grid"},[
      el("div",{class:"field col-3"},[
        el("label",{},["Average sleep (hrs)"]),
        el("select",{value:String(p.lifestyle.sleepHours), onchange:(e)=>p.lifestyle.sleepHours=parseInt(e.target.value,10)},[
          opt("4","4"),opt("5","5"),opt("6","6"),opt("7","7"),opt("8","8"),opt("9","9")
        ])
      ]),
      el("div",{class:"field col-3"},[
        el("label",{},["Work demands"]),
        el("select",{value:p.lifestyle.workDemands, onchange:(e)=>p.lifestyle.workDemands=e.target.value},[
          opt("sedentary","Mostly sitting"),opt("mixed","Mixed"),opt("on_feet","On feet all day")
        ])
      ]),
      el("div",{class:"field col-3"},[
        el("label",{},["Activity level"]),
        el("select",{value:p.lifestyle.activity, onchange:(e)=>p.lifestyle.activity=e.target.value},[
          opt("low","Low"),opt("moderate","Moderate"),opt("high","High")
        ])
      ]),
      el("div",{class:"field col-3"},[
        el("label",{},["Stress level"]),
        el("select",{value:p.lifestyle.stress, onchange:(e)=>p.lifestyle.stress=e.target.value},[
          opt("low","Low"),opt("moderate","Moderate"),opt("high","High")
        ])
      ]),
      el("div",{class:"field col-12"},[
        el("label",{},["Support at home (postpartum especially)"]),
        el("select",{value:p.lifestyle.support, onchange:(e)=>p.lifestyle.support=e.target.value},[
          opt("low","Low"),opt("moderate","Moderate"),opt("high","High")
        ])
      ])
    ]));

    return wrap;
  }

  function stepReview(){
    const p = state.profile;
    const wrap = div();

    const sk = stageKey(p);
    const dials = computeDials(p);

    const dxTags = p.diagnoses.map(k=>DIAGNOSES.find(d=>d.key===k)?.label || k);
    const sym = Object.entries(p.symptoms).map(([k,v])=>{
      const label = SYMPTOMS.find(s=>s.key===k)?.label || k;
      return `${label} (${v.severity})`;
    });

    wrap.appendChild(el("div",{class:"grid"},[
      summaryCard("Stage", [
        sk.toUpperCase(),
        p.stage.mode==="pregnant" ? `${p.stage.weeksPregnant} weeks pregnant` :
        p.stage.mode==="postpartum" ? `${p.stage.weeksPostpartum} weeks postpartum` :
        "Preconception"
      ]),
      summaryCard("Schedule", [`${p.schedule.daysPerWeek} days/week`, `${p.schedule.sessionMinutes} min sessions`, pretty(p.schedule.style)]),
      summaryCard("Equipment", [pretty(p.equipment.set), "Cardio: "+pretty(p.equipment.cardio)]),
    ]));

    const det = el("details",{open:true},[
      el("summary",{},["Computed modifiers (dials)", el("span",{class:"summary-note"},["higher = more conservative"])])
    ]);
    det.appendChild(renderDialsTable(dials));
    wrap.appendChild(det);

    const det2 = el("details",{open:false},[
      el("summary",{},["Selected diagnoses & symptoms", el("span",{class:"summary-note"},["affects substitutions + dosage"])])
    ]);
    det2.appendChild(el("p",{},["Diagnoses: ", (dxTags.length? dxTags.join(", "): "None")]));
    det2.appendChild(el("p",{},["Symptoms: ", (sym.length? sym.join(", "): "None")]));
    wrap.appendChild(det2);

    wrap.appendChild(el("p",{},["When you generate, you can save the plan and export it as JSON for backup or sharing."]));
    return wrap;
  }

  function summaryCard(title, lines){
    return el("div",{class:"panel col-4"},[
      el("h2",{},[title]),
      el("p",{},[lines.join(" • ")])
    ]);
  }

  function renderDialsTable(dials){
    const keys = ["IAP","AXIAL","ROM","ASYM","BAL","FATIGUE","HEMO","POSITION","GRIP","UPRIGHT","IMPACT","CARRY"];
    const tbl = el("table",{class:"table"},[
      el("thead",{},[el("tr",{},[el("th",{},["Dial"]),el("th",{},["Value"]),el("th",{},["Meaning"])])]),
      el("tbody",{}, keys.map(k=>{
        const meaning = dialMeaning(k);
        return el("tr",{},[el("td",{},[k]),el("td",{},[String(dials[k]||0)]),el("td",{},[meaning])]);
      }))
    ]);
    return tbl;
  }

  function dialMeaning(k){
    const map = {
      IAP:"Need to reduce intra‑abdominal pressure spikes (breath holds, grinders).",
      AXIAL:"Need to reduce axial loading (spine/compression).",
      ROM:"Need to reduce range of motion or avoid end‑range under load.",
      ASYM:"Need to reduce asymmetrical loading (PGP/SPD, SI sensitivity).",
      BAL:"Need to reduce balance demands (machines/supported work).",
      FATIGUE:"Need to reduce volume/density (sleep, anemia, late pregnancy).",
      HEMO:"Need to reduce hemodynamic strain (BP spikes, dizziness).",
      POSITION:"Need to modify positions (avoid supine, reflux, comfort).",
      GRIP:"Need to reduce grip strain (carpal tunnel).",
      UPRIGHT:"Need to limit prolonged upright loading (previa/varicosities).",
      IMPACT:"Need to avoid impact/ballistic work.",
      CARRY:"Need to limit carries/loaded walking."
    };
    return map[k] || "";
  }

  function renderRunGateCard(runGate){
    const badgeClass = runGate.ready ? "badge ok" : "badge";
    const card = el("details",{open:false, class:"details"},[
      el("summary",{},[
        "Return-to-running / impact gate ",
        el("span",{class:"summary-note"},[`${runGate.status}`])
      ]),
      el("div",{class:"panel"},[
        el("div",{class: badgeClass, style:"margin-bottom:10px"},[
          runGate.ready ? "Ready to start run-walk (if symptoms stay stable)" : "Not yet — build stability first"
        ]),
        runGate.reasons?.length ? el("ul",{}, runGate.reasons.map(r=>el("li",{},[r]))) : null,
        el("h3",{},["This week"]),
        el("ul",{}, (runGate.plan||[]).map(x=>el("li",{},[x])))
      ].filter(Boolean))
    ]);
    return card;
  }

  // --- Adaptive week regeneration (symptom-aware)
  function getAdaptiveWeek(plan, weekIndex){
    try{
      const base = plan.weeks[weekIndex];
      if(!base) return null;
      const profile = deepClone(base.profileSnapshot || state.profile);

      // Pull previous week check-in and reflect it into the next week's symptoms.
      const prev = getCheckin(plan.id, weekIndex-1);
      if(prev){
        const mapSym = (key, sev)=>{
          if(!sev || sev==="none") return;
          profile.symptoms[key] = { severity: sev, notes: "" };
        };
        mapSym("pelvic_pressure", prev.pelvic_pressure);
        mapSym("leakage", prev.leakage);
        mapSym("doming", prev.doming);
        mapSym("pgp", prev.pgp);
        mapSym("low_back", prev.low_back);
        mapSym("fatigue", prev.fatigue);
      }

      // Progression credits: every 2 “green” weeks -> one progression step.
      let green = 0;
      let regress = false;
      for(let i=0;i<weekIndex;i++){
        const c = getCheckin(plan.id, i);
        if(!c) continue;
        const redish = [c.pelvic_pressure,c.leakage,c.doming].some(v=>v==="moderate"||v==="severe");
        if(redish){
          // reset progression and flag regression for the immediate next week
          green = 0;
          if(i === weekIndex-1) regress = true;
          continue;
        }
        const ok = [c.pelvic_pressure,c.leakage,c.doming,c.pgp,c.low_back].every(v=>!v || v==="none"||v==="mild") && !c.delayedSymptoms;
        const adherenceOk = (c.adherencePct==null) || (Number(c.adherencePct) >= 70);
        if(ok && adherenceOk) green++;
      }
      const step = Math.floor(green/2);
      profile._prog = { regress, progressStep: regress ? 0 : step };

      // Regenerate this week with the updated profile.
      const regenerated = generateWeekPlan(profile, base.weekSeed || weekIndex);

      // Narrative helper: title + short explanation.
      const narrative = buildWeekNarrative(plan.id, weekIndex, profile);

      // Postpartum return-to-running / impact gate module (uses same symptom engine).
      const runGate = buildRunningImpactGate(plan.id, weekIndex, profile);

      return { ...base, ...regenerated, narrative, runGate };
    }catch(e){
      return null;
    }
  }

  // --- Narrative copy system (auto-generated week title + explanation)
  function buildWeekNarrative(planId, weekIndex, p){
    const sk = stageKey(p);
    const prev = getCheckin(planId, weekIndex-1);

    const flags = {
      red: prev ? [prev.pelvic_pressure, prev.leakage, prev.doming].some(v=>v==="moderate"||v==="severe") : false,
      yellow: prev ? ([prev.pgp, prev.low_back, prev.fatigue].some(v=>v==="moderate"||v==="severe") || !!prev.delayedSymptoms) : false,
      green: prev ? ([prev.pelvic_pressure, prev.leakage, prev.doming, prev.pgp, prev.low_back].every(v=>!v||v==="none"||v==="mild") && !prev.delayedSymptoms && (prev.adherencePct==null || Number(prev.adherencePct)>=70)) : true,
    };

    // Helper: pregnancy weeks remaining
    let weeksLeft = null;
    if(p.stage.mode === "pregnant" && p.stage.dueDate){
      const due = new Date(p.stage.dueDate);
      if(!isNaN(due.getTime())){
        const now = new Date();
        weeksLeft = Math.max(0, Math.ceil((due.getTime()-now.getTime())/(1000*60*60*24*7)));
      }
    }

    // Build a short, human title + explanation.
    const out = { title:"", explanation:"" };
    const wkNum = weekIndex + 1;

    if(p.stage.mode === "pregnant"){
      // Phase naming
      let phase = "Strength maintenance";
      if(sk === "t1") phase = "Consistency & energy";
      if(sk === "t2") phase = "Steady strength";
      if(sk === "t3") phase = "Stability & comfort";
      if(weeksLeft != null && weeksLeft <= 2) phase = "Finish-line taper";

      if(flags.red) out.title = `Week ${wkNum} — Recovery & control`;
      else out.title = `Week ${wkNum} — ${phase}`;

      const expl = [];
      if(weeksLeft != null && weeksLeft <= 2){
        expl.push("Close to due date: keep loads submaximal, avoid grinders, and prioritize breathing, posture, and mobility.");
      } else if(sk === "t3"){
        expl.push("Third trimester priorities: supported patterns, low abdominal pressure, hip/glute strength, and daily mobility.");
      } else if(sk === "t2"){
        expl.push("Second trimester priorities: maintain strength with steady breathing; progress only if symptom-free.");
      } else if(sk === "t1"){
        expl.push("First trimester priorities: consistency and energy management. Stop early if nausea/fatigue ramps up.");
      }
      if(flags.red) expl.push("Last week’s check-in flagged symptoms. This week is a hold/regress week (reduce load 10–20%, increase RIR, and choose the most supported options)." );
      else if(prev && prev.delayedSymptoms) expl.push("You reported symptoms later that day/next morning. Hold progression and keep effort truly submaximal.");
      else if(flags.yellow) expl.push("Fatigue/pain was elevated last week. Hold progression and keep sessions short and easy to recover from.");
      else if(flags.green) expl.push("Symptoms looked stable. If this week stays stable, the app will allow a small progression next week.");
      out.explanation = expl.join(" ");
      return out;
    }

    // Postpartum
    const ppw = p.stage.weeksPostpartum || 0;
    let phase = "Rebuild";
    if(sk === "pp0_6") phase = "Restore & reconnect";
    else if(sk === "pp6_16") phase = "Capacity rebuild";
    else if(sk === "pp4_12m") phase = "Reload";
    else if(sk === "pp12m_plus") phase = "Performance";

    out.title = flags.red ? `Postpartum Week ${ppw+1} — Hold & recover` : `Postpartum Week ${ppw+1} — ${phase}`;
    const expl = [];
    if(sk === "pp0_6") expl.push("Focus: breathing, pelvic floor coordination, and gentle strength (only if medically cleared)." );
    if(sk === "pp6_16") expl.push("Focus: rebuild tolerance in squat/hinge/push/pull with controlled loads and symptom-free effort." );
    if(sk === "pp4_12m") expl.push("Focus: progressive strength return with careful pelvic/core pressure management." );
    if(flags.red) expl.push("Symptoms were flagged last week. We’ll regress and stabilize before progressing again." );
    else if(flags.green) expl.push("Stable week trend: you can earn gradual progressions." );
    out.explanation = expl.join(" ");
    return out;
  }

  // --- Postpartum return-to-running / impact gate (engine-based)
  function buildRunningImpactGate(planId, weekIndex, p){
    const wantsRun = (p.goals||[]).includes("return_run");
    const modeOk = (p.stage.mode === "postpartum") && !p.hardLimits.avoidRunning;
    if(!wantsRun || !modeOk) return null;

    const ppWeeks = Number(p.stage.weeksPostpartum||0);
    const recent = [];
    for(let i=Math.max(0, weekIndex-3); i<weekIndex; i++){
      const c = getCheckin(planId, i);
      if(c) recent.push(c);
    }
    const hasData = recent.length >= 2;
    const symptomFree = hasData ? recent.slice(-2).every(c=>{
      const pelvicOk = [c.pelvic_pressure,c.leakage,c.doming].every(v=>!v||v==="none"||v==="mild");
      const painOk = [c.pgp,c.low_back].every(v=>!v||v==="none"||v==="mild");
      return pelvicOk && painOk && !c.delayedSymptoms;
    }) : false;

    // Minimum time gate: conservative baseline.
    const timeGate = ppWeeks >= 12;

    const ready = timeGate && symptomFree;
    const status = ready ? "Ready" : "Not yet";

    const reasons = [];
    if(!timeGate) reasons.push("Most people are not ready for running/impact before ~12 weeks postpartum.");
    if(!hasData) reasons.push("Complete 2 weekly check-ins so the app can confirm stability.");
    if(hasData && !symptomFree) reasons.push("Recent check-ins show pelvic/core symptoms or pain above mild — we’ll stabilize first.");

    const plan = [];
    if(ready){
      plan.push("Run/Walk 2x/week on non-lifting days: 5 min brisk walk → 8 rounds of 1 min easy jog / 1–2 min walk → 5 min walk.");
      plan.push("Stop if leakage, heaviness, doming, sharp pain, or symptoms worsen later that day.");
      plan.push("If symptom-free for 2 weeks, progress by adding 1–2 jog minutes total per session.");
    } else {
      plan.push("For now: brisk walking, incline walking, cycling, or low-impact cardio 2–3x/week (20–30 min) while strength rebuilds.");
      plan.push("Focus on calf/foot strength + single-leg control in strength sessions.");
    }

    return { status, ready, reasons, plan };
  }

  function openWeeklyCheckin(planId, weekIndex){
    // 30-second check-in: 5 questions.
    // We still store into the same canonical fields used by the engine:
    // pelvic_pressure, leakage, doming, pgp, low_back, fatigue, adherencePct
    const existing = getCheckin(planId, weekIndex) || {
      pelvic_pressure:"none",
      leakage:"none",
      doming:"none",
      pgp:"none",
      low_back:"none",
      fatigue:"none",
      adherencePct:80,
      // New: delayed symptoms later that day / next morning (pelvic/core/pain flare)
      delayedSymptoms:false,
    };

    // UI state for combined questions
    const ui = {
      pelvicSeverity: maxSev(existing.pelvic_pressure, existing.leakage),
      pelvicType: (existing.pelvic_pressure!="none" && existing.leakage!="none") ? "both" : (existing.leakage!="none" ? "leakage" : (existing.pelvic_pressure!="none" ? "heaviness" : "none")),
      delayed: existing.delayedSymptoms ? "yes" : "no",
      doming: existing.doming || "none",
      painSeverity: maxSev(existing.pgp, existing.low_back),
      painType: (existing.pgp!="none" && existing.low_back!="none") ? "both" : (existing.pgp!="none" ? "pelvis" : (existing.low_back!="none" ? "back" : "none")),
      recovery: (existing.fatigue==="none"?"great":(existing.fatigue==="mild"?"ok":"struggling")),
      completed: null,
    };

    const overlay = el("div",{class:"modal-overlay"},[]);
    const modal = el("div",{class:"modal"},[
      el("h2",{},["Weekly check-in (30 sec)"]),
      el("p",{class:"muted", style:"margin-top:-6px"},["This updates next week automatically."])
    ]);

    // Determine default completed workouts from adherencePct and current plan settings
    const days = Math.max(1, Math.min(6, Number(state.profile.schedule.daysPerWeek||3)));
    ui.completed = Math.round(((existing.adherencePct||0)/100) * days);

    const q = (title, body)=>{
      const box = el("div",{class:"qbox"},[ el("div",{class:"qtitle"},[title]), body ]);
      return box;
    };

    const seg = (value, options, onChange)=>{
      const wrap = el("div",{class:"seg"},[]);
      options.forEach(optv=>{
        const b = el("button",{class:"segbtn" + (value===optv?" active":""), type:"button"},[pretty(optv)]);
        b.onclick = ()=>{
          value = optv;
          onChange(optv);
          // refresh active states
          $$(".segbtn", wrap).forEach(btn=>btn.classList.remove("active"));
          b.classList.add("active");
        };
        wrap.appendChild(b);
      });
      return wrap;
    };

    // Q1 Pelvic symptoms: severity + type
    const pelvicBox = div();
    pelvicBox.appendChild(seg(ui.pelvicSeverity, ["none","mild","moderate","severe"], (v)=>{ ui.pelvicSeverity=v; renderExtra(); }));
    const typeRow = el("div",{class:"row", style:"margin-top:10px"},[
      el("label",{},["Type (if any)"]),
      selectInput(ui.pelvicType,[{v:"none",t:"None"},{v:"leakage",t:"Leakage"},{v:"heaviness",t:"Heaviness"},{v:"both",t:"Both"}], (v)=>{ ui.pelvicType=v; })
    ]);
    const extra = el("div",{id:"pelvicExtra"},[]);
    function renderExtra(){
      extra.innerHTML = "";
      if(ui.pelvicSeverity!=="none") extra.appendChild(typeRow);
    }
    renderExtra();
    pelvicBox.appendChild(extra);

    // Delayed symptom flare (important for postpartum running/impact gating and progression)
    const delayedRow = el("div",{class:"row", style:"margin-top:10px"},[
      el("label",{},["Did symptoms show up or worsen later that day / next morning?"]),
      selectInput(ui.delayed,[{v:"no",t:"No"},{v:"yes",t:"Yes"}], (v)=>{ ui.delayed=v; })
    ]);
    pelvicBox.appendChild(delayedRow);
    modal.appendChild(q("1) Pelvic symptoms during workouts?", pelvicBox));

    // Q2 Doming
    modal.appendChild(q("2) Any doming/coning?", seg(ui.doming, ["none","mild","moderate","severe"], (v)=>{ ui.doming=v; })));

    // Q3 Pain: severity + location
    const painBox = div();
    painBox.appendChild(seg(ui.painSeverity,["none","mild","moderate","severe"], (v)=>{ ui.painSeverity=v; renderPainExtra(); }));
    const painExtra = el("div",{id:"painExtra"},[]);
    const painTypeRow = el("div",{class:"row", style:"margin-top:10px"},[
      el("label",{},["Where?" ]),
      selectInput(ui.painType,[{v:"none",t:"—"},{v:"pelvis",t:"Pelvis (PGP/SPD)"},{v:"back",t:"Low back"},{v:"both",t:"Both"}], (v)=>{ ui.painType=v; })
    ]);
    function renderPainExtra(){
      painExtra.innerHTML = "";
      if(ui.painSeverity!=="none") painExtra.appendChild(painTypeRow);
    }
    renderPainExtra();
    painBox.appendChild(painExtra);
    modal.appendChild(q("3) Pain limiting training?", painBox));

    // Q4 Recovery
    const recMap = { great:"Great", ok:"Okay", struggling:"Struggling" };
    const recWrap = el("div",{class:"seg"},[]);
    Object.keys(recMap).forEach(k=>{
      const b = el("button",{class:"segbtn" + (ui.recovery===k?" active":""), type:"button"},[recMap[k]]);
      b.onclick = ()=>{
        ui.recovery = k;
        $$(".segbtn", recWrap).forEach(btn=>btn.classList.remove("active"));
        b.classList.add("active");
      };
      recWrap.appendChild(b);
    });
    modal.appendChild(q("4) Recovery this week?", recWrap));

    // Q5 Completed workouts
    const doneRow = el("div",{class:"row"},[
      el("label",{},["5) Workouts completed" ]),
      el("input",{type:"range", min:"0", max:String(days), value:String(ui.completed||0), oninput:(e)=>{
        ui.completed = Number(e.target.value||0);
        const out = document.getElementById("completedOut");
        if(out) out.textContent = `${ui.completed}/${days}`;
      }})
    ]);
    const doneBox = div();
    doneBox.appendChild(doneRow);
    doneBox.appendChild(el("div",{class:"muted", style:"margin-top:6px"},[
      el("span",{id:"completedOut"},[`${ui.completed}/${days}`])
    ]));
    modal.appendChild(q("", doneBox));

    const actions = div("btnrow");
    const cancel = el("button",{class:"btn", type:"button"},["Cancel"]);
    cancel.onclick = ()=> overlay.remove();
    const save = el("button",{class:"btn primary", type:"button"},["Save"]);
    save.onclick = ()=>{
      // Map UI -> canonical stored fields
      const sev = ui.pelvicSeverity;
      existing.pelvic_pressure = (sev!=="none" && (ui.pelvicType==="heaviness"||ui.pelvicType==="both")) ? sev : "none";
      existing.leakage = (sev!=="none" && (ui.pelvicType==="leakage"||ui.pelvicType==="both")) ? sev : "none";
      existing.doming = ui.doming || "none";

      // Delayed symptoms later that day / next morning
      existing.delayedSymptoms = (ui.delayed === "yes");

      existing.delayedSymptoms = (ui.delayed === "yes");

      const psev = ui.painSeverity;
      existing.pgp = (psev!=="none" && (ui.painType==="pelvis"||ui.painType==="both")) ? psev : "none";
      existing.low_back = (psev!=="none" && (ui.painType==="back"||ui.painType==="both")) ? psev : "none";

      existing.fatigue = (ui.recovery==="great") ? "none" : (ui.recovery==="ok" ? "mild" : "moderate");
      existing.adherencePct = Math.round((Number(ui.completed||0)/days) * 100);

      upsertCheckin({ ...existing, planId, weekIndex, createdAt:new Date().toISOString() });
      overlay.remove();
      render();
    };
    actions.appendChild(cancel);
    actions.appendChild(save);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    overlay.onclick = (e)=>{ if(e.target===overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }

// --- Tracking helpers (set-by-set)
function parseDosageString(str){
  // Accepts "2-3 sets x 6-12 reps" or "2 sets x 6-12 reps" etc.
  const s = String(str||"");
  const m = s.match(/(\d+)\s*-\s*(\d+)\s*sets?\s*x\s*(\d+)\s*-\s*(\d+)\s*reps?/i) ||
            s.match(/(\d+)\s*sets?\s*x\s*(\d+)\s*-\s*(\d+)\s*reps?/i);
  if(!m) return null;
  if(m.length===5){
    return {setsMin:Number(m[1]), setsMax:Number(m[2]), repsMin:Number(m[3]), repsMax:Number(m[4])};
  }
  return {setsMin:Number(m[1]), setsMax:Number(m[1]), repsMin:Number(m[2]), repsMax:Number(m[3])};
}

function plannedDosageForBlock(session, block){
  const isMain = /Main Lift/i.test(block.title) || /Upper Push|Upper Pull/i.test(block.title);
  const base = isMain ? parseDosageString(session.dosage.main) : parseDosageString(session.dosage.accessory);
  const setsMin = base?.setsMin ?? (isMain ? 2 : 1);
  const setsMax = base?.setsMax ?? (isMain ? 3 : 2);
  const repsMin = base?.repsMin ?? (isMain ? 6 : 10);
  const repsMax = base?.repsMax ?? (isMain ? 12 : 15);
  return {
    setsMin, setsMax, repsMin, repsMax,
    setsText: `${setsMin}${setsMax!==setsMin?`-${setsMax}`:""} sets`,
    repsText: `${repsMin}-${repsMax} reps`
  };
}

function addSetRow(blockContainerId, planned){
  const blk = document.getElementById(blockContainerId);
  if(!blk) return;
  const rows = blk.querySelector(".setrows");
  if(!rows) return;
  const idx = rows.querySelectorAll(".set-row").length + 1;
  const row = el("div",{class:"set-row"},[
    el("div",{class:"set-label"},[`Set ${idx}`]),
    el("input",{class:"reps", type:"text", placeholder:planned?.repsText || "reps"}),
    el("input",{class:"weight", type:"text", placeholder:"weight"}),
    el("button",{class:"btn danger", type:"button", onclick:()=>{ row.remove(); renumberSetRows(rows); }},["✕"])
  ]);
  rows.appendChild(row);
  renumberSetRows(rows);
}

function renumberSetRows(rowsEl){
  const rows = $$(".set-row", rowsEl);
  rows.forEach((r,i)=>{
    const lbl = $(".set-label", r);
    if(lbl) lbl.textContent = `Set ${i+1}`;
  });
}

  function renderWorkout(){
    const plan = state.generatedPlan;
    const p = state.profile;

    const wrap = div();
    if(!plan || !plan.weeks || !plan.weeks.length){
      wrap.appendChild(el("div",{class:"panel"},[
        el("h1",{},["No plan generated yet"]),
        el("p",{},["Go to the Profile tab to generate a plan."])
      ]));
      return wrap;
    }

    // Week selector
    const wIdx = Math.max(0, Math.min(plan.weeks.length-1, state.activeWeekIndex || 0));
    const wkBase = plan.weeks[wIdx];
    const wk = getAdaptiveWeek(plan, wIdx) || wkBase;

    const header = el("div",{class:"panel"},[
      el("div",{class:"hrow"},[
        el("div",{},[
          el("h1",{},["Your program"]),
          el("p",{},[`Created: ${new Date(plan.createdAt).toLocaleString()} • Weeks: ${plan.weeks.length}`])
        ]),
        el("div",{class:"inline"},[
          el("div",{class:"field"},[
            el("label",{},["Select week"]),
            el("select",{value:String(wIdx), onchange:(e)=>{ state.activeWeekIndex = Number(e.target.value)||0; render(); }},
              plan.weeks.map((w,i)=> el("option",{value:String(i)},[`${i+1}. ${w.label}`]))
            )
          ])
        ])
      ]),
      plan.warnings?.length ? el("div",{class:"badge danger", style:"margin-top:10px;"},[plan.warnings[0]]) : null
    ].filter(Boolean));
    wrap.appendChild(header);

    const wkHeader = el("div",{class:"panel"},[
      el("div",{class:"hrow"},[
        el("div",{},[
          el("h2",{},[wk.narrative?.title || wk.label]),
          el("p",{},[`Start date: ${wk.startDate} • Template: ${wk.template} • Stage: ${wk.stageKey.toUpperCase()}`])
        ]),
        el("div",{class:"inline"},[
          el("span",{class:"badge ok"},[`Intensity: ${wk.dosage.intensity}`]),
          el("span",{class:"badge"},[`RIR main: ${wk.dosage.rirMain}`]),
          el("span",{class:"badge"},[`RIR accessory: ${wk.dosage.rirAcc}`]),
          el("button",{class:"btn", type:"button", onclick:()=>openWeeklyCheckin(plan.id,wIdx)},["30-sec check-in"])
        ])
      ]),
      wk.narrative?.explanation ? el("p",{class:"muted"},[wk.narrative.explanation]) : null,
      wk.runGate ? renderRunGateCard(wk.runGate) : null,
      wk.warnings?.length ? el("div",{class:"badge danger", style:"margin-top:10px;"},[wk.warnings[0]]) : null
    ].filter(Boolean));
    wrap.appendChild(wkHeader);

    const det = el("details",{open:false},[
      el("summary",{},["Dosage guidance & notes", el("span",{class:"summary-note"},["auto-adjusted by modifiers"])])
    ]);
    det.appendChild(el("div",{class:"panel"},[
      el("p",{},[`Main: ${wk.dosage.base.main}`]),
      el("p",{},[`Accessory: ${wk.dosage.base.accessory}`]),
      el("p",{},[`Rest: ${wk.dosage.rest}`]),
      el("ul",{}, (wk.dosage.notes||[]).map(n=>el("li",{},[n])))
    ]));
    wrap.appendChild(det);

    // sessions + tracking (for the selected week)
    wk.sessions.forEach((s,idx)=>{
      const dateKey = todayKey();
      const card = el("div",{class:"panel"},[
        el("div",{class:"hrow"},[
          el("h2",{},[s.name]),
          el("span",{class:"badge"},[`Session ${idx+1} / ${wk.sessions.length}`]),
        ]),
        el("p",{},[`Dosage: ${s.dosage.main}; ${s.dosage.accessory}.`]),
        el("table",{class:"table"},[
          el("thead",{},[el("tr",{},[el("th",{},["Block"]),el("th",{},["Exercise"]),el("th",{},["Notes"])])]),
          el("tbody",{}, s.blocks.map(b=>el("tr",{},[
            el("td",{},[b.title]),
            el("td",{},[b.exercise]),
            el("td",{},[b.optional ? "Optional (auto-trimmed if time-limited)" : ""])
          ])))
        ]),

        el("details",{open:false},[
          el("summary",{},["Track this workout", el("span",{class:"summary-note"},["log sets/reps/weight"])])
        ]),
      ]);

      const details = card.querySelector("details");
      if(details){
        const logWrap = div("panel");
        logWrap.appendChild(el("p",{},["Date: ", el("strong",{},[dateKey]), " • ", el("strong",{},[wk.label]), " • Save a quick log for each exercise."]));

        // Build set-by-set tracker with "Add set" and autofill from planned dosage.
const tracker = el("div",{class:"tracker"}, []);
s.blocks.forEach((b,bIdx)=>{
  const planned = plannedDosageForBlock(s, b);
  const blkId = `logblk_${plan.id}_${wIdx}_${idx}_${bIdx}`;
  const blk = el("div",{class:"panel", id:blkId, "data-blk":String(bIdx), style:"padding:12px;margin-top:10px;"},[
    el("div",{class:"hrow"},[
      el("div",{},[
        el("h3",{},[b.exercise]),
        el("p",{class:"muted"},[`Planned: ${planned.setsText} • ${planned.repsText}`])
      ]),
      el("button",{class:"btn", type:"button", onclick:()=>addSetRow(blkId, planned)},["Add set"])
    ]),
    el("div",{class:"setrows"})
  ]);
  tracker.appendChild(blk);
  // initial rows
  const n0 = planned.setsMin || 1;
  for(let i=0;i<n0;i++) addSetRow(blkId, planned);
  // notes
  blk.appendChild(el("div",{class:"field", style:"margin-top:10px;"},[
    el("label",{},["Notes (optional)"]),
    el("input",{class:"note", type:"text", placeholder:"optional"})
  ]));
});
logWrap.appendChild(tracker);

        logWrap.appendChild(el("div",{class:"btnrow"},[
          el("button",{class:"btn primary", type:"button", onclick:()=>handleSaveWorkoutLog(plan, wIdx, idx)},["Save workout log"]),
          el("button",{class:"btn", type:"button", onclick:()=>route("history")},["View history"]),
        ]));
        details.appendChild(logWrap);
      }
      wrap.appendChild(card);
    });

    // Save section (requested)
    const savePanel = el("div",{class:"panel"},[
      el("h2",{},["Save this program"]),
      el("p",{},["Save for later reference. You can also export/import as JSON."]),
      el("div",{class:"grid"},[
        el("div",{class:"field col-6"},[
          el("label",{},["Program name"]),
          el("input",{id:"saveName", placeholder:"e.g., Pregnancy → due date + postpartum", value: defaultSaveName(plan, p)})
        ]),
        el("div",{class:"field col-6"},[
          el("label",{},["Notes (optional)"]),
          el("input",{id:"saveNotes", placeholder:"Anything you want to remember (symptoms, restrictions, progress)."})
        ]),
      ]),
      el("div",{class:"btnrow"},[
        el("button",{class:"btn primary", type:"button", onclick:()=>handleSavePlan(plan)},["Save to My Plans"]),
        el("button",{class:"btn", type:"button", onclick:()=>handleExport(plan)},["Export JSON"]),
        el("button",{class:"btn", type:"button", onclick:()=>route("history")},["History / Saved"]),
      ])
    ]);
    wrap.appendChild(savePanel);

    return wrap;
  }

  function defaultSaveName(plan, profile){
    const d = profile.schedule.daysPerWeek;
    const m = profile.schedule.sessionMinutes;
    const style = (profile.schedule.style || "full_body").replaceAll("_","/");
    if(profile.stage.mode === "pregnant" && profile.stage.dueDate){
      const pp = Number(profile.stage.postpartumPlanWeeks || 0);
      return `Pregnancy → due date + PP ${pp}w – ${d}d/wk – ${m}min – ${style}`;
    }
    if(profile.stage.mode === "postpartum"){
      const pp = Number(profile.stage.postpartumPlanWeeks || 24);
      return `Postpartum (${pp}w) – ${d}d/wk – ${m}min – ${style}`;
    }
    if(profile.stage.mode === "preconception"){
      return `Preconception (12w) – ${d}d/wk – ${m}min – ${style}`;
    }
    const first = plan.weeks?.[0]?.stageKey ? plan.weeks[0].stageKey.toUpperCase() : "PLAN";
    return `${first} – ${d}d/wk – ${m}min – ${style}`;
  }

  function handleSavePlan(plan){
    const name = ($("#saveName")?.value || "").trim() || defaultSaveName(plan, state.profile);
    const notes = ($("#saveNotes")?.value || "").trim();

    const saved = loadSaved();
    const entry = {
      savedId: "saved_" + Date.now(),
      name, notes,
      createdAt: plan.createdAt,
      plan,
      profile: state.profile,
    };
    saved.unshift(entry);
    saveSaved(saved);
    state.activeSavedId = entry.savedId;
    route("history");
  }

  function handleExport(plan){
    const payload = {
      exportedAt: new Date().toISOString(),
      plan,
      profile: state.profile
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nurturestrength_plan.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
  }

  function handleSaveWorkoutLog(plan, weekIdx, sessionIdx){
  const logs = loadLogs();
  const wk = plan.weeks?.[weekIdx];
  if(!wk) return alert("Could not find that week in the plan.");
  const session = wk.sessions?.[sessionIdx];
  if(!session) return alert("Could not find that session in the selected week.");

  const blocks = session.blocks.map((b,bIdx)=>{
    const blkId = `logblk_${plan.id}_${weekIdx}_${sessionIdx}_${bIdx}`;
    const blkEl = document.getElementById(blkId);
    const setRows = blkEl ? $$(".set-row", blkEl) : [];
    const sets = setRows.map(r=>({
      reps: ($(".reps", r)?.value || "").trim(),
      weight: ($(".weight", r)?.value || "").trim(),
    })).filter(x=>x.reps || x.weight);
    const notes = blkEl ? (($(".note", blkEl)?.value || "").trim()) : "";
    return { exercise: b.exercise, sets, notes };
  });

  const entry = {
    id: "log_" + Date.now(),
    date: todayKey(),
    planId: plan.id,
    weekLabel: wk.label,
    sessionName: session.name,
    blocks
  };
  logs.unshift(entry);
  saveLogs(logs);
  alert("Saved workout log.");
  route("history");
}


  function renderHistory(){
    const wrap = div();

    const saved = loadSaved();
    const logs = loadLogs();
    const header = el("div",{class:"panel"},[
      el("div",{class:"hrow"},[
        el("div",{},[
          el("h1",{},["History / Save"]),
          el("p",{},["Saved programs + workout logs on this device."])
        ]),
        el("div",{class:"btnrow"},[
          el("button",{class:"btn", type:"button", onclick:()=>route("profile")},["Edit profile / generate plan"]),
          el("button",{class:"btn", type:"button", onclick:()=>handleImportPrompt()},["Import JSON"]),
          el("button",{class:"btn danger", type:"button", onclick:()=>{ if(confirm("Delete all saved plans AND logs on this device?")){ saveSaved([]); saveLogs([]); render(); } }},["Delete all"])
        ])
      ])
    ]);
    wrap.appendChild(header);

    // Saved programs
    wrap.appendChild(el("div",{class:"panel"},[
      el("h2",{},["Saved programs"]),
      el("p",{},[saved.length ? "" : "No saved programs yet. Generate a plan and use \"Save to My Plans\"."])
    ].filter(Boolean)));

    saved.forEach(entry=>{
      const card = el("div",{class:"panel"},[
        el("div",{class:"hrow"},[
          el("div",{},[
            el("h2",{},[entry.name]),
            el("p",{},[`Saved: ${new Date(entry.createdAt).toLocaleString()}`]),
            entry.notes ? el("p",{},["Notes: "+entry.notes]) : null
          ].filter(Boolean)),
          el("div",{class:"btnrow"},[
            el("button",{class:"btn primary", type:"button", onclick:()=>{ state.generatedPlan = entry.plan; state.profile = entry.profile; route("workout"); }},["Open"]),
            el("button",{class:"btn", type:"button", onclick:()=>downloadEntry(entry)},["Export JSON"]),
            el("button",{class:"btn danger", type:"button", onclick:()=>deleteEntry(entry.savedId)},["Delete"])
          ])
        ]),
        el("details",{open:false},[
          el("summary",{},["Quick view"]),
          el("div",{class:"codebox"},[formatQuickView(entry.plan)])
        ])
      ]);
      wrap.appendChild(card);
    });

    // Workout logs
    wrap.appendChild(el("div",{class:"panel"},[
      el("h2",{},["Workout logs"]),
      el("p",{},[logs.length ? "" : "No workout logs yet. Use Workout → Track this workout to save."])
    ].filter(Boolean)));

    logs.slice(0,50).forEach(l=>{
  const isEditing = state.editingLogId === l.id;

  const card = el("div",{class:"panel"},[
    el("div",{class:"hrow"},[
      el("div",{},[
        el("h3",{},[`${l.date} — ${l.sessionName}`]),
        el("p",{},[`Week: ${l.weekLabel} • Plan: ${l.planId}`])
      ]),
      el("div",{class:"btnrow"},[
        isEditing
          ? el("button",{class:"btn primary", type:"button", onclick:()=>saveEditedLog(l.id)},["Save changes"])
          : el("button",{class:"btn", type:"button", onclick:()=>{ state.editingLogId = l.id; render(); }},["Edit"]),
        isEditing
          ? el("button",{class:"btn", type:"button", onclick:()=>{ state.editingLogId = null; render(); }},["Cancel"])
          : null,
        el("button",{class:"btn danger", type:"button", onclick:()=>{ if(confirm("Delete this workout log?")){ deleteLog(l.id); } }},["Delete"])
      ].filter(Boolean))
    ]),
  ]);

  if(!isEditing){
    card.appendChild(el("table",{class:"table"},[
      el("thead",{},[el("tr",{},[
        el("th",{},["Exercise"]),
        el("th",{},["Sets"]),
        el("th",{},["Details"]),
        el("th",{},["Notes"]),
      ])]),
      el("tbody",{}, (l.blocks||[]).map((b,bi)=>{
        const sets = Array.isArray(b.sets) ? b.sets : [];
        const details = sets.map((s,i)=>`#${i+1} ${s.reps||""}${s.weight?` @ ${s.weight}`:""}`.trim()).join(" • ");
        return el("tr",{},[
          el("td",{},[b.exercise]),
          el("td",{},[String(sets.length || "")]),
          el("td",{},[details]),
          el("td",{},[b.notes||""])
        ]);
      }))
    ]));
  }else{
    (l.blocks||[]).forEach((b,bi)=>{
      const blkId = `editlog_${l.id}_${bi}`;
      const blk = el("div",{class:"panel", id:blkId, style:"padding:12px;margin-top:10px;"},[
        el("div",{class:"hrow"},[
          el("h3",{},[b.exercise]),
          el("button",{class:"btn", type:"button", onclick:()=>addEditLogSetRow(blkId)},["Add set"])
        ]),
        el("div",{class:"setrows"})
      ]);
      card.appendChild(blk);
      const rows = blk.querySelector(".setrows");
      const sets = Array.isArray(b.sets) ? b.sets : [];
      if(sets.length){
        sets.forEach(()=>addEditLogSetRow(blkId));
        $$(".set-row", rows).forEach((r,idx)=>{
          $(".reps", r).value = sets[idx]?.reps || "";
          $(".weight", r).value = sets[idx]?.weight || "";
        });
      }else{
        addEditLogSetRow(blkId);
      }
      blk.appendChild(el("div",{class:"field", style:"margin-top:10px;"},[
        el("label",{},["Notes"]),
        el("input",{class:"note", type:"text", value:(b.notes||"")})
      ]));
    });
  }

  wrap.appendChild(card);
});

    return wrap;
  }

  function formatQuickView(plan){
    const lines = [];
    lines.push(`Weeks: ${plan.weeks?.length || 0} | Created: ${plan.createdAt}`);
    lines.push("");
    const showWeeks = (plan.weeks || []).slice(0,2);
    for(const w of showWeeks){
      lines.push(`${w.label} — ${w.template} (${w.stageKey.toUpperCase()})`);
      lines.push(`Intensity: ${w.dosage?.intensity} | RIR main: ${w.dosage?.rirMain}`);
      for(const s of (w.sessions||[])){
        lines.push(`  ${s.name}`);
        for(const b of (s.blocks||[])) lines.push(`    - ${b.title}: ${b.exercise}`);
      }
      lines.push("");
    }
    if((plan.weeks||[]).length > 2) lines.push("… (open program to view all weeks)");
    return lines.join("\n");
  }

  function downloadEntry(entry){
    const payload = { exportedAt:new Date().toISOString(), ...entry };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nurturestrength_saved_plan.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
  }

  function deleteEntry(savedId){
    const saved = loadSaved();
    const next = saved.filter(x=>x.savedId !== savedId);
    saveSaved(next);
    render();
  }

  function deleteLog(logId){
    const logs = loadLogs();
    const next = logs.filter(x=>x.id !== logId);
    saveLogs(next);
    render();
  }

  function handleImportPrompt(){
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async ()=>{
      const file = input.files?.[0];
      if(!file) return;
      const text = await file.text();
      try{
        const obj = JSON.parse(text);
        // accept either exported plan payload or saved entry
        const saved = loadSaved();
        let entry;
        if(obj.savedId && obj.plan){
          entry = obj;
        }else if(obj.plan){
          entry = {
            savedId: "saved_" + Date.now(),
            name: (obj.plan.template || "Imported plan") + " (imported)",
            notes: "",
            createdAt: obj.plan.createdAt || new Date().toISOString(),
            plan: obj.plan,
            profile: obj.profile || defaultProfile()
          };
        }else{
          alert("Unrecognized JSON format.");
          return;
        }
        saved.unshift(entry);
        saveSaved(saved);
        render();
      }catch(e){
        alert("Could not parse JSON.");
      }
    };
    input.click();
  }

function addEditLogSetRow(blockContainerId){
  const blk = document.getElementById(blockContainerId);
  if(!blk) return;
  const rows = blk.querySelector(".setrows");
  if(!rows) return;
  const row = el("div",{class:"set-row"},[
    el("div",{class:"set-label"},["Set"]),
    el("input",{class:"reps", type:"text", placeholder:"reps"}),
    el("input",{class:"weight", type:"text", placeholder:"weight"}),
    el("button",{class:"btn danger", type:"button", onclick:()=>{ row.remove(); renumberSetRows(rows); }},["✕"])
  ]);
  rows.appendChild(row);
  renumberSetRows(rows);
}

function saveEditedLog(logId){
  const logs = loadLogs();
  const idx = logs.findIndex(x=>x.id===logId);
  if(idx<0) return;
  const log = logs[idx];
  const nextBlocks = (log.blocks||[]).map((b,bi)=>{
    const blkId = `editlog_${logId}_${bi}`;
    const blkEl = document.getElementById(blkId);
    const setRows = blkEl ? $$(".set-row", blkEl) : [];
    const sets = setRows.map(r=>({
      reps: ($(".reps", r)?.value || "").trim(),
      weight: ($(".weight", r)?.value || "").trim(),
    })).filter(x=>x.reps || x.weight);
    const notes = blkEl ? (($(".note", blkEl)?.value || "").trim()) : (b.notes||"");
    return { ...b, sets, notes };
  });
  logs[idx] = { ...log, blocks: nextBlocks, editedAt: new Date().toISOString() };
  saveLogs(logs);
  state.editingLogId = null;
  render();
}

  function renderAbout(){
    const wrap = div("panel");
    wrap.appendChild(el("h1",{},["About this MVP"]));
    wrap.appendChild(el("p",{},[
      "This is a lightweight prototype that demonstrates the core engine: ",
      "stage-aware base templates + constraint-based modifiers + saved plans. "
    ]));
    wrap.appendChild(el("p",{},[
      "Next steps (if you continue building): add a real database, accounts, clinical consent flows, ",
      "exercise video library, progression tracking, and a more robust rules engine for injuries + sport returns."
    ]));
    wrap.appendChild(el("details",{open:false},[
      el("summary",{},["How the engine works"]),
      el("div",{class:"codebox"},[
`1) Base template chosen by stage (preconception / trimester / postpartum phase)
2) Dials computed from symptoms, diagnoses, hard limits, lifestyle
3) Each movement pattern picks the best exercise from the library using the dials
4) Dosage (intensity + RIR + rest) adjusted conservatively when dials are high
5) Optional accessories auto-trimmed for short sessions
6) Plan can be saved locally and exported/imported as JSON`
      ])
    ]));
    return wrap;
  }

  // --- UI helpers
  function el(tag, attrs={}, children=[]){
    const node = document.createElement(tag);
    for(const [k,v] of Object.entries(attrs)){
      if(k==="class") node.className = v;
      else if(k==="style") node.style.cssText = v;
      // Ensure form controls are wired correctly. Setting the *property* matters for select/input/textarea.
      else if(k==="value") node.value = v;
      else if(k==="checked") node.checked = !!v;
      else if(k.startsWith("on") && typeof v === "function") node[k] = v;
      else if(v === null || v === undefined) {}
      else node.setAttribute(k, v);
    }
    (children||[]).forEach(c=>{
      if(c===null || c===undefined) return;
      if(typeof c === "string") node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }
  function div(cls){ return el("div", {class: cls||""}, []); }
  function opt(value, label, selected){
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    if(selected) o.selected = true;
    return o;
  }
  function pretty(s){
    return String(s).replace(/_/g," ").replace(/\b\w/g, m=>m.toUpperCase());
  }

  // Small UI building blocks used in Profile/Setup to reduce reading.
  function card(title, body){
    return el("div",{class:"card"},[
      el("div",{class:"card-title"},[title]),
      el("div",{class:"card-body"},[body || "—"]),
    ]);
  }

  function sectionDetails(title, contentEl){
    return el("details",{class:"details"},[
      el("summary",{},[title]),
      contentEl
    ]);
  }

  function selectInput(value, options, onChange){
    // options: [{v,t}]
    return el("select",{value, onchange:(e)=>onChange(e.target.value)}, options.map(o=>opt(o.v,o.t,o.v===value)));
  }

  function textareaInput(value, onChange){
    return el("textarea",{value, rows:"2", oninput:(e)=>onChange(e.target.value)},[]);
  }

  function goalLabels(goals){
    const map = {
      maintain_strength:"Maintain strength",
      build_muscle:"Build muscle",
      reduce_pain:"Reduce pain / feel better",
      prepare_for_delivery:"Prepare for delivery",
      return_heavy:"Return to heavy lifting",
      return_running:"Return to running",
      improve_glucose:"Improve glucose control",
      posture_endurance:"Posture/upper back endurance",
    };
    return (goals||[]).map(g=>map[g]||pretty(g));
  }

  function programStyleLabel(style){
    const map = { full_body:"Full-body", upper_lower:"Upper/Lower", ab_split:"2-day A/B", abc_rotation:"3-day A/B/C" };
    return map[style] || pretty(style);
  }

  function equipmentLabel(set){
    const map = { gym_full:"Full gym", home_db:"Home dumbbells", bands_only:"Bands only", barbell:"Barbell setup" };
    return map[set] || pretty(set);
  }

  function stageSummaryText(p){
    if(p.stage.mode === "pregnant"){
      const due = p.stage.dueDate ? ` • due ${p.stage.dueDate}` : "";
      return `Pregnant • week ${p.stage.weeksPregnant}${due}`;
    }
    if(p.stage.mode === "postpartum") return `Postpartum • week ${p.stage.weeksPostpartum+1} • ${p.stage.deliveryType}${p.stage.breastfeeding?" • breastfeeding":""}`;
    return pretty(p.stage.mode);
  }

  function stageWeekQuickEditor(p){
    if(p.stage.mode === "pregnant"){
      return el("div",{class:"row"},[
        el("input",{type:"number", min:"0", max:"42", value:String(p.stage.weeksPregnant||0), oninput:(e)=>{ p.stage.weeksPregnant = Math.max(0,Math.min(42,Number(e.target.value||0))); }},[]),
        el("button",{class:"btn", type:"button", onclick:()=>{ p.stage.weeksPregnant = Math.min(42,(p.stage.weeksPregnant||0)+1); render(); }},["+1 wk"])
      ]);
    }
    if(p.stage.mode === "postpartum"){
      return el("div",{class:"row"},[
        el("input",{type:"number", min:"0", max:"104", value:String(p.stage.weeksPostpartum||0), oninput:(e)=>{ p.stage.weeksPostpartum = Math.max(0,Math.min(104,Number(e.target.value||0))); }},[]),
        el("button",{class:"btn", type:"button", onclick:()=>{ p.stage.weeksPostpartum = Math.min(104,(p.stage.weeksPostpartum||0)+1); render(); }},["+1 wk"])
      ]);
    }
    return el("span",{class:"muted"},["—"]);
  }

  function renderConstraintsSnapshot(p){
    const dials = computeDials(p);
    const top = Object.entries(dials)
      .filter(([k,v])=>typeof v === "number" && v>0 && k!=="FREQ")
      .sort((a,b)=>b[1]-a[1])
      .slice(0,6)
      .map(([k,v])=>`${k}: ${v}`)
      .join(" • ");
    const dx = (p.diagnoses||[]).map(k=>DIAGNOSES.find(d=>d.key===k)?.label||pretty(k)).join("; ") || "None";
    const limits = Object.entries(p.hardLimits||{}).filter(([k,v])=>v===true).map(([k])=>pretty(k)).join(", ") || "None";
    return el("div",{},[
      el("p",{class:"muted"},["Top constraints: ", top || "—"]),
      el("p",{},[el("strong",{},["Diagnoses: "]), dx]),
      el("p",{},[el("strong",{},["Hard limits: "]), limits]),
    ]);
  }

  function fieldSelect(label, value, options, onChange, help){
    const f = div("field");
    f.appendChild(el("label",{},[label]));
    const sel = el("select",{value, onchange:(e)=>onChange(e.target.value)}, options.map(([v,l])=>opt(v,l)));
    f.appendChild(sel);
    if(help) f.appendChild(el("div",{class:"help"},[help]));
    return f;
  }

  function fieldCheckbox(label, checked, onChange){
    const f = div("field");
    f.appendChild(el("label",{},[label]));
    const sel = el("select",{value: checked ? "yes":"no", onchange:(e)=>onChange(e.target.value==="yes")},[
      opt("no","No", !checked), opt("yes","Yes", checked)
    ]);
    f.appendChild(sel);
    return f;
  }

  function fieldRange(label, value, min, max, step, onChange, help){
    const f = div("field");
    f.appendChild(el("label",{},[`${label}: ${value}`]));
    const input = el("input",{type:"range", min:String(min), max:String(max), step:String(step), value:String(value),
      oninput:(e)=>{ onChange(parseInt(e.target.value,10)); render(); }
    });
    f.appendChild(input);
    if(help) f.appendChild(el("div",{class:"help"},[help]));
    return f;
  }

  // init route handlers
  window.addEventListener("hashchange", ()=>{
    const r = location.hash.replace("#","").trim();
    if(r) route(r);
  });

  // initial render
  render();
})();
