// The title screen's level: a meadow with high walls at both ends. Climbers
// go up the walls and float back down, others build and bash, for ever.
export const TITLE_LEVEL = {
  name: 'Title', rating: '', count: 40, save: 0, rate: 70, time: 99, style: 'earth',
  skills: { climber: 99, floater: 99, builder: 99, basher: 99 }, width: 320,
  terrain: [
    ['land', 0, 320, 140, 159, 2],
    ['rect', 0, 64, 10, 96], ['rect', 310, 64, 10, 96],
    ['oval', 160, 150, 40, 18, { mat: 'alt' }],
    ['rect', 250, 100, 8, 45],
  ],
  objects: [['entrance', 70, 92], ['entrance', 200, 92]],
  solution: [
    { skill: 'climber', x: 40, count: 40 },
    { skill: 'floater', x: 290, count: 40 },
    { skill: 'basher', x: 238, dir: 1, count: 40 },
  ],
};
