import { PhysicsWorld } from '../../src/engine/PhysicsWorld';
import { VehicleController, NEUTRAL_INPUT, type DriveInput } from '../../src/vehicles/VehicleController';
import { STARTER_SPEC, type DrivingMode, type VehicleSpec } from '../../src/vehicles/VehiclePhysics';
import { PHYSICS_DT } from '../../src/utils/constants';

export interface Sim {
  physics: PhysicsWorld;
  car: VehicleController;
  time: number;
  /** Run for `seconds` with a constant (or time-varying) input. */
  run(seconds: number, input: Partial<DriveInput> | ((t: number) => Partial<DriveInput>)): void;
  pos(): { x: number; y: number; z: number };
  impacts: number[];
}

export async function createSim(
  mode: DrivingMode = 'arcade',
  spec: VehicleSpec = STARTER_SPEC,
  walls = false,
  gripAt?: (x: number, z: number) => number,
): Promise<Sim> {
  const physics = await PhysicsWorld.create();
  physics.addStaticBox({ x: 0, y: -1, z: 0 }, { x: 2000, y: 1, z: 2000 }, 0, 1);
  if (walls) physics.addStaticBox({ x: 0, y: 1.5, z: -150 }, { x: 40, y: 1.5, z: 0.5 }, 0, 0);
  const impacts: number[] = [];
  const car = new VehicleController(physics, spec, { onImpact: (m) => impacts.push(m), gripAt });
  car.setMode(mode);
  car.placeAt(0, 0.62, 0, 0);
  const sim: Sim = {
    physics,
    car,
    time: 0,
    impacts,
    pos: () => car.body.translation(),
    run(seconds, input) {
      const steps = Math.round(seconds / PHYSICS_DT);
      for (let i = 0; i < steps; i++) {
        const inp = typeof input === 'function' ? input(sim.time) : input;
        car.update(PHYSICS_DT, { ...NEUTRAL_INPUT, ...inp });
        physics.step();
        sim.time += PHYSICS_DT;
      }
    },
  };
  return sim;
}
