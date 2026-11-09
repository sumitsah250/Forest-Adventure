// Hints for every mission objective, shown in the objective panel (G, the journal,
// a local you talk to, or automatically when the player is stuck). Each list goes
// from a nudge to exact instructions: where to go, what to look at, which key.

export const MISSION_HINTS: Record<string, string[]> = {
  // 1 · Range Day
  'm1-take': [
    'The range is just east of the trailhead lot. Follow the marker along the footpath to the shooting bench.',
    'At the bench, look at the lockbox and hold E to unlock it, then press E again to take the pistol.',
  ],
  'm1-draw': ['Your pistol is holstered. Press 1 (or H) to draw it.', 'Press 1 on the keyboard, then wait a moment until it is in your hands.'],
  'm1-holster': ['Press H to put the pistol away, then press H again to draw it.'],
  'm1-aim': [
    'Face the steel plates downrange (follow the marker) and hold the right mouse button to aim.',
    'Keep holding the right mouse button and move the crosshair onto a plate until it turns red.',
  ],
  'm1-plates': [
    'Aim with the right mouse button, then click the left button to fire. A plate rings when you hit it.',
    'Hold still for a moment before each shot: the crosshair ticks close in when you are steady. Hit each of the three plates once.',
  ],
  'm1-reload': ['Press R to reload.'],
  'm1-qualify': [
    'Two paper silhouettes stand at 13 m and 22 m. You need four hits in total, with at least one on each target.',
    'Aim (right mouse), wait for the crosshair to tighten, then fire (left mouse). Press R to reload if the magazine runs dry.',
  ],
  // 2 · The Silent Station
  'm2-reach': [
    'Get in your truck (E at the driver\'s door) and drive north up Hollow Creek Road. Follow the marker.',
    'The station spur turns right off the road, past the abandoned maroon SUV, about two kilometres in.',
  ],
  'm2-logbook': [
    'Open the station door (E) and go inside. Hale kept her logbook on her desk.',
    'The logbook is on the metal desk against the back wall, straight in from the door. Look at it and press E.',
  ],
  'm2-locker': [
    'The combination is 4-1-7. The gun locker is inside the station.',
    'The green steel locker stands against the left wall by the front window. Hold E to dial, then press E to take the shotgun.',
  ],
  'm2-radio': [
    'The radio is on Hale\'s desk inside the station. Its standby light is glowing now.',
    'Look at the radio on the desk and press E to play the last transmission.',
  ],
  'm2-key': [
    'Hale said the spare Ridge Gate key is in the station\'s key cabinet.',
    'The key cabinet hangs on the inside wall to the left of the desk. Look at it and press E.',
  ],
  'm2-leave': [
    'Drive back to the road and head north toward the creek. The bridge is out: Hale\'s tyre tracks leave the road just before it.',
    'Follow the marker to the tyre tracks before the broken bridge. This step ends once you are about 70 m from the station.',
  ],
  // 3 · The Lost Patrol
  'm3-ford': [
    'The bridge is out. Hale\'s tyre tracks leave the road just before it and run downstream to a shallow ford.',
    'Drive along the tracks to the ford (follow the marker), cross the creek slowly, and climb back to the road on the far side.',
  ],
  'm3-gate': ['Ridge Gate closes Ridge Road north of the creek. You have the spare key.', 'Walk up to the gate and press E to unlock it.'],
  'm3-bend': [
    'Drive up Ridge Road past the gate and watch the edge where the road runs along the ravine.',
    'Stop at the sharp bend above the ravine, look at the skid marks at the edge and press E.',
  ],
  'm3-wreck': ['Unit 4 is lying on its side down the slope below the bend.', 'Climb carefully down from the bend to the truck and press E to search it.'],
  'm3-revolver': [
    'The revolver was thrown clear of the cab. Look on the ground beside the wreck.',
    'Walk around the cab side of the truck and look down into the mud. Press E when the prompt appears.',
  ],
  'm3-ambush': [
    'Two poachers are coming down from the road. Get behind a tree trunk or the wreck before they see you.',
    'Crouch (Ctrl or Q) behind cover, aim with the right mouse button and fire when they stop. Badly hurt poachers surrender.',
  ],
  'm3-tape': [
    'Hale flagged her route with orange tape near the wreck.',
    'Look for orange tape on the trees west of the wreck and press E on it, then follow the tape along the creek bottom.',
  ],
  'm3-hale': ['The tape leads west along the creek bottom to the Miller cabin.', 'Follow the marker to the cabin door and press E to knock.'],
  // 4 · Protect the Ranger Route
  'm4-call': ['Get back in your truck (E at the driver\'s door).', 'Sitting in the truck, press T to radio dispatch.'],
  'm4-reach': [
    'The poachers have set up a roadblock on Ridge Road, between the bend and the gate. Follow the marker.',
    'Leave the truck short of the roadblock and walk the last stretch through the trees.',
  ],
  'm4-identify': [
    'Find cover with a view of the roadblock, then hold the right mouse button and aim at one of the poachers.',
    'You only need to aim at one of them: you do not have to fire.',
  ],
  'm4-clear': [
    'Use the trees and their truck as cover. Fire from cover, then move.',
    'Crouch to stay hidden, aim before you fire, and reload (R) behind cover. Wounded poachers surrender.',
  ],
  'm4-search': ['Their pickup is parked at the roadblock.', 'Walk up to the poachers\' truck and press E to search it.'],
  'm4-rescue': ['Stay near the roadblock until the rescue team radios in.', 'Just wait by the roadblock: the step ends when the radio call finishes.'],
  // 5 · The Hidden Supply Cache
  'm5-map': ['Press M to open the map and find the CACHE waypoint.', 'Press M, look for the waypoint east of the hidden camp, then press M again to close the map.'],
  'm5-search': [
    'The waypoint is east of the hidden camp, off the ATV trail. Follow the marker.',
    'Walk to the marker: the step completes when you are within about 20 m of it.',
  ],
  'm5-entrance': [
    'Boot prints leave the ATV trail. Follow them to a pile of cut branches.',
    'The pile of branches beside the orange-marked stake hides the entrance. Hold E to pull them aside.',
  ],
  'm5-open': ['Look at the hatch and hold E to lift it.'],
  'm5-take': [
    'The rifle and the ledger are inside the cache.',
    'Look down into the open hatch: press E to take the rifle, and E again on the ledger to read it.',
  ],
  // 6 · Clear the Blocked Route
  'm6-reach': ['The poachers have blocked the ford crossing. Follow the marker back to the creek.', 'Drive toward the ford, but stop well short of it and go on foot.'],
  'm6-scout': [
    'Find high ground or cover with a view of the crossing, then aim at the blockade with the right mouse button.',
    'Getting within about 40 m, or aiming at one of the poachers, completes this step.',
  ],
  'm6-loadout': [
    'Press Tab to see your weapons, then press a number (1-8) to equip one.',
    'A rifle suits the long, open track; the shotgun suits the thick brush on the creek bank. Press its number and wait until it is ready.',
  ],
  'm6-clear': ['Four poachers hold the crossing. Use the brush and trees as cover.', 'Crouch to stay hidden, take them one at a time and reload behind cover.'],
  'm6-search': ['Their truck is parked by the crossing.', 'Walk up to the poachers\' truck and press E to search it.'],
  'm6-winch': ['A felled tree blocks the track. You need your truck close by to winch it.', 'Drive your truck within 25 m of the log, get out, look at the log and hold E.'],
  // 7 · Track the Source
  'm7-review': ['Press J to open your journal and read the ledger and GPS entries.', 'Open the journal with J, then close it again with J.'],
  'm7-atv': [
    'The hidden camp is around the old fire pit. The ATV trail leaves from there.',
    'Follow the marker to the fire pit, look at the ATV tracks on the ground and press E.',
  ],
  'm7-follow': ['Follow the ATV tracks east from the hidden camp. The marker shows "the landing".', 'Keep heading east along the trail: the step ends when you get close to their base camp.'],
  'm7-take': ['Five armed poachers, one of them up in a tree stand. Deal with the tree stand first.', 'Stay out of the open, use cover, and watch for the shooter in the tree stand.'],
  'm7-search': [
    'Kessler\'s gun rack is under the trailer awning; his notes are on the table.',
    'Press E at the gun rack to take the rifle, then E at the table to read the notes.',
  ],
  // 8 · Final Forest Operation
  'm8-reach': [
    'Drive back down Hollow Creek Road to the trailhead. Follow the marker.',
    'Stop the truck before the trailhead lot and go the rest of the way on foot so they don\'t hear you coming.',
  ],
  'm8-confirm': ['From cover, hold the right mouse button and aim at Kessler.', 'Kessler has a beard, a camo cap and a brown work jacket. Aim at him to confirm it is him.'],
  'm8-stop': ['Five armed men, Kessler among them. Use the vehicles and trees as cover.', 'Fight from cover and reload behind it. Wounded poachers surrender.'],
  'm8-arrest': ['Kessler has surrendered. Walk up to him.', 'Look at Kessler and hold E to cuff him.'],
  'm8-report': ['Get in your truck (E at the driver\'s door).', 'In the truck, press T to radio dispatch.'],
};
