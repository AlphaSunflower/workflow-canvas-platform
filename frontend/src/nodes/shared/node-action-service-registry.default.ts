import { createNodeActionServiceRegistry } from './node-action-service-registry';
import {
  createStoryboardActionFacade,
  createStoryboardActionFacadeDependencies,
} from '../ai-storyboard/storyboard-action-facade';

export const defaultNodeActionServiceRegistry = createNodeActionServiceRegistry()
  .register('aiStoryboard', ({ services }) => {
    if (!services || typeof services !== 'object') {
      throw new Error('Storyboard node action services are unavailable.');
    }

    return createStoryboardActionFacade(
      createStoryboardActionFacadeDependencies(
        services as Parameters<typeof createStoryboardActionFacadeDependencies>[0],
      ),
    );
  });
