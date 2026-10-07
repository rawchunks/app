import * as Tone from 'tone';

try {
  const context = new Tone.OfflineContext(2, 44100, 44100);
  Tone.setContext(context);
  console.log("Tone OfflineContext set successfully");
  const gain = new Tone.Gain(1.0);
  console.log("Created Tone.Gain in OfflineContext successfully:", !!gain);
} catch (e) {
  console.error("OfflineContext failed:", e);
}
