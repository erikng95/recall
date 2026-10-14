import { useStore } from '../store.ts';

/** Seed a small, interlinked example knowledge base so new users can see how things work. */
export function loadSampleData() {
  const st = useStore.getState();
  const health = st.createTopic('Health', undefined, '🩺');
  const sleep = st.createTopic('Sleep', health.id, '😴');
  const nutrition = st.createTopic('Nutrition', health.id, '🥗');
  const science = st.createTopic('Science', undefined, '🔬');
  const bio = st.createTopic('Biology', science.id, '🧬');

  st.createNote({
    title: 'Circadian rhythm',
    topicIds: [sleep.id, bio.id],
    body: `The body's roughly ==24-hour== internal clock that regulates sleep, hormones and body temperature.

- The master clock sits in the ==suprachiasmatic nucleus== (SCN) of the hypothalamus.
- Its main time cue ("zeitgeber") is **light** hitting the retina — see [[Morning sunlight sets your clock]].
- [[Melatonin]] rises in the evening as light fades.

Related: [[Adenosine and sleep pressure]]`,
    tags: ['sleep', 'physiology'],
    source: { kind: 'podcast', title: 'Huberman Lab — Master your sleep', author: 'Andrew Huberman' },
  });

  st.createNote({
    title: 'Morning sunlight sets your clock',
    topicIds: [sleep.id],
    body: `Claim: getting bright outdoor light within ~30–60 min of waking helps anchor the [[Circadian rhythm]] and makes it easier to fall asleep at night.

Light intensity matters: outdoors on an overcast day is often ==over 1,000 lux==, vs a few hundred indoors.`,
    tags: ['sleep', 'habits'],
    source: { kind: 'podcast', title: 'Huberman Lab — Master your sleep', locator: '12:40' },
    verification: {
      verdict: 'mostly-supported',
      confidence: 0.75,
      summary:
        'Light is the dominant cue for the circadian clock and morning light advances its phase; strong lab evidence. The specific "within 30 minutes" window is a practical heuristic rather than a hard threshold.',
      evidence: [
        { title: 'Khalsa et al. 2003 — phase response curve to light in humans (J Physiol)', url: 'https://doi.org/10.1113/jphysiol.2003.040568', stance: 'supports', quality: 'high' },
        { title: 'Blume et al. 2019 — Effects of light on human circadian rhythms, sleep and mood (review)', url: 'https://doi.org/10.1007/s11818-019-00215-x', stance: 'supports', quality: 'high' },
        { title: 'No trials establishing a precise 30-minute cutoff', stance: 'context', quality: 'medium' },
      ],
      checkedAt: Date.now(),
      checkedBy: 'claude',
    },
  });

  st.createNote({
    title: 'Melatonin',
    topicIds: [sleep.id, bio.id],
    body: `Hormone secreted by the ==pineal gland== in darkness; signals "biological night" to the body. It's a timing signal more than a sedative — see [[Circadian rhythm]].`,
    tags: ['sleep', 'hormones'],
  });

  st.createNote({
    title: 'Adenosine and sleep pressure',
    topicIds: [sleep.id, bio.id],
    body: `Adenosine builds up in the brain the longer you're awake, creating "sleep pressure". ==Caffeine== blocks adenosine receptors, which is why it masks tiredness — see [[Caffeine half-life]].`,
    tags: ['sleep', 'caffeine'],
  });

  st.createNote({
    title: 'Caffeine half-life',
    topicIds: [nutrition.id],
    body: `Caffeine's half-life in healthy adults is roughly ==5 hours== (range ~1.5–9.5 h), so an afternoon coffee can still affect [[Adenosine and sleep pressure|sleep]] at bedtime.`,
    tags: ['caffeine'],
    tasks: ['verify'],
  });

  st.createNote({
    title: 'We only use 10% of our brain',
    topicIds: [bio.id],
    body: `Heard this in a movie. Is it true?`,
    tags: ['myths'],
    verification: {
      verdict: 'false',
      confidence: 0.97,
      summary: 'Brain imaging shows virtually all regions are active over a day; damage to almost any area causes deficits. A long-debunked myth.',
      evidence: [{ title: 'Scientific American — Do people only use 10 percent of their brains?', url: 'https://www.scientificamerican.com/article/do-people-only-use-10-percent-of-their-brains/', stance: 'contradicts', quality: 'medium' }],
      checkedAt: Date.now(),
      checkedBy: 'claude',
    },
  });

  st.addInbox({
    text: 'Podcast said that cold showers boost dopamine by 250% for hours. Check this.',
    source: { kind: 'podcast', title: 'Some health podcast' },
  });
}
