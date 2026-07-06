import VButton from '@/components/VButton.vue';
import VInput from '@/components/VInput.vue';
import VModal from '@/components/VModal.vue';
import VCard from '@/components/VCard.vue';
import VBadge from '@/components/VBadge.vue';
import VEmptyState from '@/components/VEmptyState.vue';

describe('VButton.vue', () => {
  it('should render with default props', () => {
    cy.mount(VButton, {
      slots: { default: 'Click me' }
    });
    cy.get('.v-btn').should('exist').should('contain', 'Click me');
    cy.get('.v-btn').should('have.class', 'v-btn--primary');
    cy.get('.v-btn').should('have.class', 'v-btn--medium');
  });

  it('should apply variant classes', () => {
    const variants = ['primary', 'secondary', 'danger', 'ghost', 'link'];
    variants.forEach((variant) => {
      cy.mount(VButton, {
        props: { variant },
        slots: { default: 'Button' }
      });
      cy.get('.v-btn').should('have.class', `v-btn--${variant}`);
    });
  });

  it('should apply size classes', () => {
    const sizes = ['small', 'medium', 'large'];
    sizes.forEach((size) => {
      cy.mount(VButton, {
        props: { size },
        slots: { default: 'Button' }
      });
      cy.get('.v-btn').should('have.class', `v-btn--${size}`);
    });
  });

  it('should show spinner when loading', () => {
    cy.mount(VButton, {
      props: { loading: true },
      slots: { default: 'Loading' }
    });
    cy.get('.v-btn__spinner').should('exist');
    cy.get('.v-btn').should('have.class', 'v-btn--loading');
  });

  it('should be disabled when disabled prop is true', () => {
    cy.mount(VButton, {
      props: { disabled: true },
      slots: { default: 'Disabled' }
    });
    cy.get('.v-btn').should('be.disabled');
    cy.get('.v-btn').should('have.class', 'v-btn--disabled');
  });

  it('should apply full-width class', () => {
    cy.mount(VButton, {
      props: { fullWidth: true },
      slots: { default: 'Wide' }
    });
    cy.get('.v-btn').should('have.class', 'v-btn--full-width');
  });
});

describe('VInput.vue', () => {
  it('should render input field with label', () => {
    cy.mount(VInput, {
      props: { modelValue: 'test', label: 'Label' }
    });
    cy.get('input').should('exist');
    cy.get('.v-input__label').should('contain', 'Label');
  });

  it('should display error message', () => {
    cy.mount(VInput, {
      props: { error: 'Error text' }
    });
    cy.get('.v-input__error').should('contain', 'Error text');
    cy.get('.v-input').should('have.class', 'v-input--error');
  });

  it('should display help text', () => {
    cy.mount(VInput, {
      props: { help: 'Help text' }
    });
    cy.get('.v-input__help').should('contain', 'Help text');
  });

  it('should be disabled when disabled prop is true', () => {
    cy.mount(VInput, {
      props: { disabled: true }
    });
    cy.get('input').should('be.disabled');
    cy.get('.v-input').should('have.class', 'v-input--disabled');
  });

  it('should generate unique id', () => {
    cy.mount(VInput, {
      props: { label: 'Test' }
    });
    cy.get('input').should('have.attr', 'id').and('match', /^v-input-/);
  });

  it('should apply size classes', () => {
    const sizes = ['small', 'medium', 'large'];
    sizes.forEach((size) => {
      cy.mount(VInput, {
        props: { size }
      });
      cy.get('.v-input').should('have.class', `v-input--${size}`);
    });
  });
});

describe('VModal.vue', () => {
  it('should not render when modelValue is false', () => {
    cy.mount(VModal, {
      props: { modelValue: false },
      slots: { default: 'Content' }
    });
    cy.get('.v-modal-overlay').should('not.exist');
  });

  it('should render when modelValue is true', () => {
    cy.mount(VModal, {
      props: { modelValue: true },
      slots: { default: 'Content' }
    });
    cy.get('.v-modal-overlay').should('exist');
    cy.get('.v-modal__body').should('contain', 'Content');
  });

  it('should display title', () => {
    cy.mount(VModal, {
      props: { modelValue: true, title: 'Test Modal' }
    });
    cy.get('.v-modal__title').should('contain', 'Test Modal');
  });

  it('should apply size classes', () => {
    const sizes = ['small', 'medium', 'large', 'fullscreen'];
    sizes.forEach((size) => {
      cy.mount(VModal, {
        props: { modelValue: true, size }
      });
      cy.get('.v-modal').should('have.class', `v-modal--${size}`);
    });
  });

  it('should have overlay that can be clicked', () => {
    cy.mount(VModal, {
      props: { modelValue: true }
    });
    cy.get('.v-modal-overlay').should('exist').click({ force: true });
  });

  it('should have close button that can be clicked', () => {
    cy.mount(VModal, {
      props: { modelValue: true }
    });
    cy.get('.v-modal__close').should('exist').click();
  });

  it('should not render close button when closable is false', () => {
    cy.mount(VModal, {
      props: { modelValue: true, closable: false }
    });
    cy.get('.v-modal__close').should('not.exist');
  });

  it('should render header slot content', () => {
    cy.mount(VModal, {
      props: { modelValue: true },
      slots: { header: '<div class="custom-header">Custom</div>' }
    });
    cy.get('.custom-header').should('contain', 'Custom');
  });

  it('should render footer slot content', () => {
    cy.mount(VModal, {
      props: { modelValue: true },
      slots: { footer: '<div class="custom-footer">Footer</div>' }
    });
    cy.get('.custom-footer').should('contain', 'Footer');
  });
});

describe('VCard.vue', () => {
  it('should render with default padding', () => {
    cy.mount(VCard, {
      slots: { default: 'Body content' }
    });
    cy.get('.v-card__body').should('contain', 'Body content');
  });

  it('should apply padding classes', () => {
    const paddings = ['none', 'small', 'medium', 'large'];
    paddings.forEach((padding) => {
      cy.mount(VCard, {
        props: { padding }
      });
      cy.get('.v-card').should('have.class', `v-card--${padding}`);
    });
  });

  it('should render header slot', () => {
    cy.mount(VCard, {
      slots: { header: '<div>Header</div>' }
    });
    cy.get('.v-card__header').should('contain', 'Header');
  });

  it('should render footer slot', () => {
    cy.mount(VCard, {
      slots: { footer: '<div>Footer</div>' }
    });
    cy.get('.v-card__footer').should('contain', 'Footer');
  });

  it('should apply hover class when hover is true', () => {
    cy.mount(VCard, {
      props: { hover: true }
    });
    cy.get('.v-card').should('have.class', 'v-card--hover');
  });
});

describe('VBadge.vue', () => {
  it('should not show indicator when modelValue is false', () => {
    cy.mount(VBadge, {
      props: { modelValue: false },
      slots: { default: 'Content' }
    });
    cy.get('.v-badge__indicator').should('not.exist');
  });

  it('should show indicator when modelValue is true', () => {
    cy.mount(VBadge, {
      props: { modelValue: true },
      slots: { default: 'Content' }
    });
    cy.get('.v-badge__indicator').should('exist');
  });

  it('should show indicator by default', () => {
    cy.mount(VBadge, {
      slots: { default: 'Content' }
    });
    cy.get('.v-badge__indicator').should('exist');
  });

  it('should apply color classes', () => {
    const colors = ['default', 'primary', 'danger', 'success', 'warning', 'info'];
    colors.forEach((color) => {
      cy.mount(VBadge, {
        props: { color, modelValue: true },
        slots: { default: 'Content' }
      });
      cy.get('.v-badge').should('have.class', `v-badge--${color}`);
    });
  });

  it('should apply size classes', () => {
    const sizes = ['small', 'medium', 'large'];
    sizes.forEach((size) => {
      cy.mount(VBadge, {
        props: { size, modelValue: true },
        slots: { default: 'Content' }
      });
      cy.get('.v-badge').should('have.class', `v-badge--${size}`);
    });
  });

  it('should apply dot class when dot is true', () => {
    cy.mount(VBadge, {
      props: { modelValue: true, dot: true },
      slots: { default: 'Content' }
    });
    cy.get('.v-badge').should('have.class', 'v-badge--dot');
  });
});

describe('VEmptyState.vue', () => {
  it('should render title and description', () => {
    cy.mount(VEmptyState, {
      props: { title: 'No items', description: 'No items found' }
    });
    cy.get('.v-empty-state__title').should('contain', 'No items');
    cy.get('.v-empty-state__description').should('contain', 'No items found');
  });

  it('should render icon slot', () => {
    cy.mount(VEmptyState, {
      slots: { icon: '<div class="icon">Icon</div>' }
    });
    cy.get('.icon').should('contain', 'Icon');
  });

  it('should render actions slot', () => {
    cy.mount(VEmptyState, {
      slots: { actions: '<div class="actions">Actions</div>' }
    });
    cy.get('.actions').should('contain', 'Actions');
  });
});
