import './mockAudio';
import * as Tone from 'tone';

Tone.setContext(new Tone.Context());

const volNode = new Tone.Volume(0);
console.log('--- Test 1: rampTo AFTER mute ---');
volNode.mute = true;
volNode.volume.rampTo(-6, 0.05);
console.log('mute state:', volNode.mute); // false (BUG)

console.log('--- Test 2: rampTo BEFORE mute ---');
volNode.volume.rampTo(-6, 0.05);
volNode.mute = true;
console.log('mute state:', volNode.mute); // true (CORRECT!)

volNode.mute = false;
console.log('unmuted volume value:', volNode.volume.value); // -6 (CORRECT!)
