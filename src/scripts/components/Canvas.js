import React from 'react';
import PropTypes from 'prop-types';
import './Canvas.scss';
import StartScreen from './StartScreen.js';
import Draggable from './Draggable.js';
import Dropzone from './Dropzone.js';
import ConfirmationDialog from './ConfirmationDialog.js';
import EditorOverlay from './EditorOverlay';

export default class Canvas extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      clickHandeled: false,
      placing: null,
      deleting: null,
      editorOverlay: 'inactive',
      editorContents: {
        top: {
          icon: '',
          title: '',
          saveButton: "Save changes",
          closeButton: "close"
        },
        content: {
        }
      },
      nodeSpecs: { // TODO: Get from DOM ?
        width: 121,
        height: 32,
        spacing: 29
      },
      content: this.props.content
    };
  }

  handleDocumentClick = () => {
    if (this.state.clickHandeled) {
      this.setState({
        clickHandeled: false
      });
    }
    else if (this.state.placing !== null) {
      this.setState({
        placing: null
      });
      this.props.onInserted();
    }
  }

  componentDidMount() {
    this.props.onRef(this);

    // Handle document clicks (for exiting placing mode/state)
    document.addEventListener('click', this.handleDocumentClick);
  }

  componentWillUnmount() {
    this.props.onRef(undefined);

    document.removeEventListener('click', this.handleDocumentClick);
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.inserting) {
      this.setState({
        placing: -1,
        library: nextProps.inserting.library
      });
    }
  }

  handlePlacing = (id) => {
    if (this.state.placing !== null && this.state.placing !== id) {
      // Try to replace
      this.setState({
        clickHandeled: true,
        deleting: id
      });
    }
    else {
      // Start placing
      this.setState({
        clickHandeled: true,
        placing: id
      });
    }
  }

  handleMove = (id) => {
    const draggable = this['draggable-' + id];
    const points = draggable.getPoints();
    this.dropzones.forEach(dropzone => {
      if (!dropzone || dropzone === draggable) {
        return; // Skip
      }

      if (dropzone.overlap(points)) {
        dropzone.highlight();
      }
      else {
        dropzone.dehighlight();
      }
    });
  }

  handleDropped = (id) => {
    // Check if the node overlaps with one of the drop zones
    const draggable = this['draggable-' + id];
    const points = draggable.getPoints();
    let data;
    if (!this.dropzones.some(dropzone => {
        if (!dropzone || dropzone === draggable) {
          return; // Skip
        }

        if (dropzone.overlap(points)) {
          if (dropzone instanceof Draggable && this.state.editorOverlay === 'inactive') {
            this.setState({
              deleting: dropzone.props.id
            });
          }
          if (this.state.editorOverlay === 'inactive') {
            data = this.placeInTree(id, dropzone.props.nextContentId, dropzone.props.parent);
          }
          else {
            const parentId = this.child.saveData();
            if (parentId !== undefined) {
              data = this.placeInTree(id, dropzone.props.nextContentId, parentId);
            }
          }
          return true;
        }
      })) {
      this.setState({
        placing: null
      });
    }
    this.props.onInserted(data);
  }

  handleDropzoneClick = (nextContentId, parent) => {
    if (this.state.placing === null) {
      return;
    }

    this.placeInTree(this.state.placing, nextContentId, parent);
    this.props.onInserted();
  }

  handleEditContent = (id) => {
    const data = this.state.content[id];
    this.props.openEditor(data);
  }

  getNewContentParams = () => {
    return {
      type: {
        library: this.state.library.name,
        params: {},
        subContentId: H5P.createUUID()
      },
      contentTitle: this.state.library.name.split('.')[1], // TODO: There's probably a better default
      showContentTitle: false,
    };
  }

  contentIsBranching(content) {
    return content.type.library.split(' ')[0] === 'H5P.BranchingQuestion';
  }

  updateNextContentId(leaf, id, currentNextId, nextContentId, bumpIdsUntil) {
    // Make old parent point directly to our old children
    if (leaf.nextContentId === id) {
      leaf.nextContentId = currentNextId;
    }

    // Make our new parent aware of us
    if (nextContentId !== undefined && leaf.nextContentId === nextContentId) {
      leaf.nextContentId = id;
    }

    // Bump IDs if array has changed
    if (leaf.nextContentId < bumpIdsUntil) {
      leaf.nextContentId++;
    }
  }

  placeInTree(id, nextContentId, parent) {
    let newNode;
    this.setState(prevState => {
      let newState = {
        placing: null,
        content: [...prevState.content]
      };

      // Handle inserting of new node
      if (id === -1) {
        newNode = this.getNewContentParams();
        newState.content.push(newNode);
        id = newState.content.length - 1;
        if (id === 0) {
          // This is the first node added, nothing more needs to be done.
          return newState;
        }
      }

      // When placing after a leaf node keep track of it so we can update it
      // after processing the new content array
      if (parent !== undefined) {
        parent = newState.content[parent];
      }

      const currentNextId = newState.content[id].nextContentId;
      // TODO: What to do if we are a branching?

      // Handle adding new top node before the current one
      let bumpIdsUntil = -1;
      if (nextContentId === 0) {
        // We are the new top node, we must move to the top of the array
        newState.content.splice(0, 0, newState.content[id]);

        // Mark IDs for bumping due to array changes
        bumpIdsUntil = id + 1;
      }

      // Handle moving current top node to somewhere else
      if (id === 0) {
        // Place our current next node at the top
        newState.content.splice(0, 0, newState.content[currentNextId]);

        // Mark IDs for bumping due to array changes
        bumpIdsUntil = currentNextId + 1;
      }

      newState.content.forEach((content, index) => {
        if (index === bumpIdsUntil) {
          return; // Duplicate in array, must not be processed twice.
        }

        if (this.contentIsBranching(content)) {
          if (content.type.params &&
              content.type.params.alternatives) {
            content.type.params.alternatives.forEach(alternative =>
              this.updateNextContentId(alternative, id, currentNextId, nextContentId, bumpIdsUntil));
          }
        }
        else {
          this.updateNextContentId(content, id, currentNextId, nextContentId, bumpIdsUntil);
        }
      });

      // Update parent directly when placing a new leaf node
      if (parent !== undefined) {
        parent.nextContentId = (id === 0 ? 1 : id);
        // TODO: What to do if we are branching?
      }

      // Continue handling new top node
      if (nextContentId === 0) {
        // Remove old entry
        newState.content.splice(bumpIdsUntil, 1);

        // Use the previous top node as children
        newState.content[0].nextContentId = 1;
        // TODO: What to do if we are branching?
      }
      else if (id === 0) {
        // Remove duplicate entry
        newState.content.splice(bumpIdsUntil, 1);

        // Start using our new children
        newState.content[1].nextContentId = (nextContentId === 1 ? 2 : nextContentId);
        // TODO: What to do if we are branching?
      }
      else if (nextContentId !== undefined) {
        // Start using our new children
        newState.content[id].nextContentId = nextContentId;
        // TODO: What to do if we are branching?
      }

      return newState;
    });

    // Set contentIds explicitly
    // TODO: Mutating the state directly will go wrong and cause issues at one point, see https://reactjs.org/docs/react-component.html#state
    this.state.content.forEach((item, index) => {
      item.contentId = index // TODO: Find a way to avoid having this extra variable to maintain all the time – I believe it's changed but not updated in more places than here.
    });

    return newNode;
  }

  renderDropzone(id, position, parent, num) {
    const nextContentId = (parent !== undefined) ? undefined : id;
    num = num || 0;
    return ( this.state.editorOverlay === 'inactive' &&
      <Dropzone
        key={ id + '-dz-' + num }
        ref={ element => this.dropzones.push(element) }
        nextContentId={ nextContentId }
        parent={ parent }
        position={ position }
        elementClass={ 'dropzone' }
        style={
          {
            left: position.x + 'px',
            top: position.y + 'px'
          }
        }
        onClick={ () => this.handleDropzoneClick(nextContentId, parent) }
      />
    );
  }

  getLibraryTitle(library) {
    if (!this.props.libraries) {
      return library;
    }

    for (var i = 0; i < this.props.libraries.length; i++) {
      if (this.props.libraries[i].name === library) {
        return this.props.libraries[i].title;
      }
    }

    return library;
  }

  getBranchingChildren(content) {
    if (!content.type || !content.type.params ||
        !content.type.params.alternatives ||
        !content.type.params.alternatives.length) {
      return; // No alternatives today
    }

    let children = [];
    content.type.params.alternatives.forEach(alternative => {
      if (alternative.nextContentId !== undefined) {
        children.push(alternative.nextContentId);
      }
    });

    return children;
  }

  renderTree = (branch, x, y, parent) => {
    let nodes = [];

    // Libraries must be loaded before tree can be drawn
    if (!this.props.libraries || this.props.translations.lenght === 0) {
      nodes.push(
        <div key={ 'loading' } className="loading">Loading…</div>
      );
      branch = []; // Stops rendering
    }

    // Set defaults
    if (branch === undefined) {
      branch = [];
    }
    else if (!Array.isArray(branch)) {
      branch = [branch]; // Must always be array
    }
    if (x === undefined) {
      x = 0; // X level start
    }
    if (y === undefined) {
      y = 1; // Y level start
    }

    let firstX, lastX;
    branch.forEach(id => {
      const content = this.state.content[id];
      if (!content) {
        return; // Does not exist, simply skip.
      }

      // Determine if we're a branching question
      const contentIsBranching = (content.type.library.split(' ')[0] === 'H5P.BranchingQuestion');

      // Determine if we have any children
      const children = (contentIsBranching ? this.getBranchingChildren(content) : content.nextContentId);

      // Draw subtree first so we know where to position the node
      const subtree = this.renderTree(children, x, y + 1, id);
      const subtreeWidth = subtree.x - x;

      if (x !== 0) {
        x += this.state.nodeSpecs.spacing; // Add spacing between nodes
      }

      // Determine position of node
      let position = {
        x: x,
        y: y * 100
      }

      if (subtreeWidth >= this.state.nodeSpecs.width) {
        // Center parent above subtree
        position.x += ((subtree.x - x) / 2) - (this.state.nodeSpecs.width / 2);
      }

      const libraryTitle = this.getLibraryTitle(content.type.library).trim();

      // Draw node
      nodes.push(
        <Draggable
          key={ id }
          id={ id }
          ref={ element => { this['draggable-' + id] = element; if (this.state.placing !== null && this.state.placing !== id) this.dropzones.push(element) } }
          position={ position }
          width={ this.state.nodeSpecs.width }
          onPlacing={ () => this.handlePlacing(id) }
          onMove={ () => this.handleMove(id) }
          onDropped={ () => this.handleDropped(id) }
          contentClass={ libraryTitle.replace(/ +/g, '') } // TODO: Define className when libraries are loaded instead of redoing it for each draggable
          editContent={ () => this.handleEditContent(id) }
        >
          { libraryTitle }
        </Draggable>
      );

      // Add vertical line above (except for top node)
      const nodeCenter = position.x + (this.state.nodeSpecs.width / 2);
      if (id !== 0) {
        nodes.push(
          <div key={ id + '-vabove' } className="vertical-line" style={ {
            left: nodeCenter + 'px',
            top: (position.y - this.state.nodeSpecs.spacing) + 'px',
            height: this.state.nodeSpecs.spacing + 'px'
          } }/>
        );
      }

      // Extra lines for BQ
      if (contentIsBranching) {
        // Add vertical line below
        nodes.push(
          <div key={ id + '-vbelow' } className="vertical-line" style={ {
            left: nodeCenter + 'px',
            top: (position.y + this.state.nodeSpecs.height) + 'px',
            height: this.state.nodeSpecs.spacing + 'px'
          } }/>
        );

        if (content.type.params.alternatives.length > 1) {
          // Add horizontal line below
          nodes.push(
            <div key={ id + '-hbelow' } className="horizontal-line" style={ {
              left: (x + (this.state.nodeSpecs.width / 2)) + 'px',
              top: (position.y + this.state.nodeSpecs.height + this.state.nodeSpecs.spacing) + 'px',
              width: subtree.dX + 'px'
            } }/>
          );
        }
      }

      // Add dropzones when placing, except for below the one being moved
      if (this.state.placing !== null && this.state.placing !== id) {

        // Add dropzone above
        if (this.state.placing !== parent) {
          nodes.push(this.renderDropzone(id, {
            x: position.x + 40, // TODO: Decide on spacing a better way?
            y: position.y - 52
          }));
        }

        // Add dropzone below if there's no subtree
        if (!subtree.nodes.length) {
          nodes.push(this.renderDropzone(id, {
            x: position.x + 40, // TODO: Decide on spacing a better way?
            y: position.y + 42
          }, id, 1));
        }

      }

      // Increase same level offset + offset required by subtree
      x += (subtreeWidth >= this.state.nodeSpecs.width ? subtreeWidth : this.state.nodeSpecs.width);

      // Merge our trees
      nodes = nodes.concat(subtree.nodes);

      if (firstX === undefined) {
        firstX = position.x;
      }
      lastX = position.x;
    });

    return {
      nodes: nodes,
      x: x,
      dX: (firstX !== undefined ? lastX - firstX : 0) // Width of this subtree level only (used for pretty trees)
    };
  }

  /**
   * Remove a leaf from the tree (if it's really a leaf).
   * TODO: Can probably be replaced by general delete function
   *
   * @param {number} id - Id of the leaf.
   *
   */
  removeLeaf = (id) => { // TODO: Functions that are used as event handlers should be prefixed handle*
    if (id < this.state.content.length && !this.state.content[id].nextContentId) {
      // TODO: Stop mutating state directly
      this.state.content.splice(id, 1);
    }
  }

  /**
   * Render the editor overlay.
   *
   * @param {string} [state] - Display state [active|inactive].
   * @return {object} React render object.
   */
  renderEditorOverlay({state = 'inactive', form = {}, content={}} = {}) {
    // TODO: Don't use a separate function for rendering when there's no need for extra operations – placing it directly in render makes it much easier to read.
    return (
      <EditorOverlay // TODO: It's quite difficult to see which content the overlay is being displayed for
        onRef={ ref => (this.child = ref) } // TODO: Ideally we should use a state or property instead of a direct reference.
        state={ state }
        editorContents={ this.state.editorContents }
        form={form}
        closeForm={ this.toggleEditorOverlay.bind(this) } // TODO: No need to use .bind if the function decleared using = () => { }
        removeData={ this.removeLeaf } // Event handlers passed in should be prefixed with on* to avoid confusion with data attributes.
        main={ this.props.main }
        content={ content }
        canvas={ this } // TODO: This is a big no-no in React. The overlay should communicate through events. (In an ideal world the editor overlay should be reusable in other projects without <Canvas>)
        onChange={ () => {
          // Workaround for merging React with the save-by-reference principle
          this.props.main.params.content = this.state.content;
          // TODO: Find a better way of handling this. Maybe an event retuning a new ref each time the state changes.
        } }
      />
    );
  }

  /**
   * Toggle the editor overlay.
   *
   * @param {boolean} visibility - Override visibility toggling.
   */
  toggleEditorOverlay(visibility) {
    if (visibility === true) {
      visibility = 'active'; // TODO: Visibility is usually hidden or visible, not active or inactive.
    }
    else if (visibility === false) {
      visibility = 'inactive'; // TODO: Seems like it would have been easier if this was a boolean value?
    }
    else {
      visibility = undefined;
    }
    this.setState({ // TODO: Use prevState instead of this.state
      editorOverlay: visibility || ((this.state.editorOverlay === 'active') ? 'inactive' : 'active')
    });
  }

  updateNextContentIdAfterReplace(leaf, id, currentNextId) {
    // Move current children of the moved node to grand parent
    if (leaf.nextContentId === id) {
      leaf.nextContentId = currentNextId;
    }

    // Decrease all next ID values larger than the deleted node
    if (leaf.nextContentId > id) {
      leaf.nextContentId--;
    }
  }

  handleDelete = () => {
    // Set new parent for node
    this.setState(prevState => {
      let newState = {
        placing: null,
        deleting: null,
        content: [...prevState.content]
      };

      let id = this.state.placing;
      if (id === -1) {
        // Insert new node
        newState.content.push(this.getNewContentParams());
        id = newState.content.length - 1;
      }

      const currentNextId = newState.content[id].nextContentId;
      // TODO: What to do if we are a branching?

      // Make their children our own
      newState.content[id].nextContentId = newState.content[this.state.deleting].nextContentId;
      // TODO: Handle branching scenario

      // Replace the node (preserves tree drawing order)
      newState.content[this.state.deleting] = newState.content[id];
      newState.content.splice(id, 1);

      // What are we doing?
      newState.content.forEach(content => {
        if (this.contentIsBranching(content)) {
          if (content.type.params &&
              content.type.params.alternatives) {
            content.type.params.alternatives.forEach(alternative =>
              this.updateNextContentIdAfterReplace(alternative, id, currentNextId));
          }
        }
        else {
          this.updateNextContentIdAfterReplace(content, id, currentNextId);
        }
      });

      return newState;
    });
  }

  handleCancel = () => {
    this.setState({
      placing: null,
      deleting: null
    });
  }

  componentDidUpdate() {

    // Center the tree
    if (this.treeWidth !== this.lastTreeWidth) {
      this.lastTreeWidth = this.treeWidth;
      this.refs.tree.style.marginLeft = '';
      const raw = this.refs.tree.getBoundingClientRect();
      this.refs.tree.style.marginLeft = ((raw.width - this.treeWidth) / 2) + 'px';
    }
  }

  render() {
    this.dropzones = [];

    // Generate the tree
    const tree = this.renderTree(0);
    this.treeWidth = tree.x;

    return (
      <div className="wrapper">

        { !! this.props.inserting &&
          <Draggable
            inserting={ this.props.inserting }
            ref={ element => this['draggable--1'] = element }
            width={ this.state.nodeSpecs.width }
            onMove={ () => this.handleMove(-1) }
            onDropped={ () => this.handleDropped(-1) }
            contentClass={ this.props.inserting.library.title.replace(/ +/g, '') }
            position={ this.props.inserting.position }
          >
            { this.props.inserting.library.title }
          </Draggable>
        }

        <div className="canvas">
          { this.state.deleting !== null &&
            <ConfirmationDialog
              handleDelete={ this.handleDelete }
              handleCancel={ this.handleCancel }
            />
          }
          <div className="tree" ref={ 'tree' }>
            { tree.nodes }
          </div>
          { !tree.nodes.length &&
            <StartScreen
              handleClicked={ this.props.navigateToTutorial }
            >
              { this.renderDropzone(-1, {
                  x: 363.19, // TODO: Decide on spacing a better way?
                  y: 130
                }) }
            </StartScreen>
          }
          { this.renderEditorOverlay({
            state: this.state.editorOverlay,
            content: this.state.content
          }) }
        </div>
      </div>
    );
  }
}

Canvas.propTypes = {
  width: PropTypes.number,
  inserting: PropTypes.object
};
