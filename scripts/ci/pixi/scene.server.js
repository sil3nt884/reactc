import 'pixi.js/unsafe-eval';
import { Container, Graphics } from 'pixi.js';
const scene = new Container();
scene.addChild(new Graphics().rect(4, 4, 24, 24).fill(0xff0000));
const bounds = scene.getLocalBounds();
console.log(bounds.x, bounds.y, bounds.width, bounds.height);
