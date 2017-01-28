import React from "react";
import { connect } from "react-redux";
import {
  populateMetadataStore,
  populateTreeStore,
  populateSequencesStore,
  populateFrequenciesStore,
  populateEntropyStore,
  BROWSER_DIMENSIONS
} from "../actions";
import { CHANGE_LAYOUT, CHANGE_DISTANCE_MEASURE, CHANGE_DATE_MIN,
  CHANGE_DATE_MAX, CHANGE_ABSOLUTE_DATE_MIN, CHANGE_ABSOLUTE_DATE_MAX } from "../actions/controls";

import "whatwg-fetch"; // setup polyfill
import Radium from "radium";
import _ from "lodash";
import Flex from "./framework/flex";
import Header from "./framework/header";
import Footer from "./framework/footer";
import Background from "./framework/background";
import ToggleSidebarTab from "./framework/toggle-sidebar-tab";
import Controls from "./controls/controls";
import Frequencies from "./charts/frequencies";
import Entropy from "./charts/entropy";
import Map from "./map/map";
import TreeView from "./tree/treeView";
import parseParams from "../util/parseParams";
import queryString from "query-string";
import getColorScale from "../util/getColorScale";
import { parseGenotype, getGenotype } from "../util/getGenotype";
import * as globals from "../util/globals";
import { defaultDateRange, defaultLayout,
  defaultDistanceMeasure } from "../util/globals";
import Sidebar from "react-sidebar";
import moment from 'moment';

const returnStateNeeded = (fullStateTree) => {
  return {
    tree: fullStateTree.tree,
    sequences: fullStateTree.sequences,
    metadata: fullStateTree.metadata,
    selectedLegendItem: fullStateTree.controls.selectedLegendItem,
    dateMin: fullStateTree.controls.dateMin,
    dateMax: fullStateTree.controls.dateMax
  };
};
@connect(returnStateNeeded)
@Radium
class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      sidebarOpen: false,
      sidebarDocked: false,
      location: {
        pathname: this.props.location.pathname,           // injected by react-router
        query: this.props.location.query                  // injected by react-router
      },
      colorScale: {
        colorBy: null,
        scale: null,
        legendBoundsMap: null,
        continuous: null
      },
      // sidebarDocked: true,
    };
  }
  static propTypes = {
    /* react */
    dispatch: React.PropTypes.func,
    params: React.PropTypes.object,
    /* component api */
    error: React.PropTypes.object,
    loading: React.PropTypes.bool,
    user: React.PropTypes.object,
    routes: React.PropTypes.array
    // foo: React.PropTypes.string
  }
  static defaultProps = {
    // foo: "bar"

  }

  /******************************************
   * LIFECYLCE METHODS
   *****************************************/

  componentWillReceiveProps(nextProps) {
    let cScale;
    const tmpQuery = this.props.location.query;
    if (tmpQuery.colorBy) {
      cScale = getColorScale(tmpQuery.colorBy, nextProps.tree, nextProps.sequences,
                                 this.props.metadata.metadata ? this.props.metadata.metadata.color_options : null);
    }
    else {
      cScale = getColorScale("country", nextProps.tree, nextProps.sequences,
                                 this.props.metadata.metadata ? this.props.metadata.metadata.color_options : null);
    }
    this.setState({
      colorScale: cScale
    });
  }

  componentWillMount() {

    this.initializeReduxStore();

    var mql = window.matchMedia(`(min-width: ${globals.controlsHiddenWidth}px)`);
    mql.addListener(this.mediaQueryChanged.bind(this));
    this.setState({mql: mql, sidebarDocked: mql.matches});

    const tmpQuery = this.props.location.query;
    const cScale = this.updateColorScale(tmpQuery.colorBy || "region");
    const pathname = this.props.location.pathname;
    const suffix = (pathname.length && pathname[pathname.length - 1] !== "/") ? "/" : "";
    this.setState({
      location: {
        pathname: pathname + suffix,
        query: tmpQuery
      },
      colorScale: cScale.colorScale
    });
  }

  componentDidMount() {
    // when the user hits the back button or forward, let us know so we can setstate again
    // all of the other intentional route changes we will manually setState
    const tmpQuery = this.props.location.query;
    this.maybeFetchDataset();
    const cScale = this.updateColorScale(tmpQuery.colorBy || "region");
    window.addEventListener("popstate", (a, b, c) => {
      this.setState({
        location: {
          pathname: this.props.location.pathname.slice(1, -1),
          query: tmpQuery
        },
        colorScale: cScale.colorScale
      });
    });

    /* initial dimensions */
    this.handleResize()
    /* future resizes */
    window.addEventListener(
      'resize',
      _.throttle(this.handleResize.bind(this), 500, { /* fire every N milliseconds. Could also be _.debounce for 'wait until resize stops' */
        leading: true,
        trailing: true
      }) /* invoke resize event at most twice per second to let redraws catch up */
    );
  }

  componentDidUpdate() {
    this.maybeFetchDataset();
    if (!this.state.colorScale) {
      const cScale = this.updateColorScale(this.state.location.query.colorBy || "region");
      this.setState(cScale);
    }
  }

  numericDate(secSinceUnix) {
    const res = 1970 + (secSinceUnix / 365.25 / 24 / 3600 / 1000);
    return res;
  }

  initializeReduxStore() {

    // initialize to query param if available, otherwise use defaults
    if (this.props.location.query.l) {
      this.props.dispatch({ type: CHANGE_LAYOUT, data: this.props.location.query.l });
    } else {
      this.props.dispatch({ type: CHANGE_LAYOUT, data: defaultLayout });
    }

    if (this.props.location.query.m) {
      this.props.dispatch({ type: CHANGE_DISTANCE_MEASURE,
                            data: this.props.location.query.m });
    } else {
      this.props.dispatch({ type: CHANGE_DISTANCE_MEASURE,
                            data: defaultDistanceMeasure });
    }

    // update absolute date range
    const absoluteMin = moment().subtract(defaultDateRange, "years").format("YYYY-MM-DD");
    const absoluteMax = moment().format("YYYY-MM-DD");
    this.props.dispatch({ type: CHANGE_ABSOLUTE_DATE_MIN, data: absoluteMin });
    this.props.dispatch({ type: CHANGE_ABSOLUTE_DATE_MAX, data: absoluteMax });

    // set selected date range to query params if they exist, if not set to defaults
    if (this.props.location.query.dmin) {
      this.props.dispatch({ type: CHANGE_DATE_MIN, data: this.props.location.query.dmin });
    } else {
      this.props.dispatch({ type: CHANGE_DATE_MIN, data: absoluteMin });
    }

    if (this.props.location.query.dmax) {
      this.props.dispatch({ type: CHANGE_DATE_MAX, data: this.props.location.query.dmax });
    } else {
      this.props.dispatch({ type: CHANGE_DATE_MAX, data: absoluteMax });
    }

  }

  handleResize() {
    this.props.dispatch({
      type: BROWSER_DIMENSIONS,
      data: {
        width: window.innerWidth,
        height: window.innerHeight,
        docHeight: window.document.body.clientHeight /* background needs this because sidebar creates absolutely positioned container and blocks height 100% */
      }
    })
  }

  maybeFetchDataset() {
    if (this.state.latestValidParams === this.state.location.pathname) {
      return;
    }

    const parsedParams = parseParams(this.state.location.pathname);
    const tmp_levels = Object.keys(parsedParams.dataset).map((d) => parsedParams.dataset[d]);
    tmp_levels.sort((x, y) => x[0] > y[0]);
    // make prefix for data files with fields joined by _ instead of / as in URL
    const data_path = tmp_levels.map((d) => d[1]).join("_");
    if (parsedParams.incomplete) {
      this.setVirusPath(parsedParams.fullsplat);
    }
    if (parsedParams.valid && this.state.latestValidParams !== parsedParams.fullsplat) {
      this.props.dispatch(populateMetadataStore(data_path));
      this.props.dispatch(populateTreeStore(data_path));
      this.props.dispatch(populateSequencesStore(data_path));
      this.props.dispatch(populateFrequenciesStore(data_path));
      this.props.dispatch(populateEntropyStore(data_path));
      this.setState({latestValidParams: parsedParams.fullsplat});
    }
  }

  /******************************************
   * HANDLE QUERY PARAM CHANGES AND ASSOCIATED STATE UPDATES
   *****************************************/
  setVirusPath(newPath) {
    const prefix = (newPath === "" || newPath[0] === "/") ? "" : "/";
    const suffix = (newPath.length && newPath[newPath.length - 1] !== "/") ? "/?" : "?";
    const url = prefix + newPath + suffix + queryString.stringify(this.state.location.query);
    window.history.pushState({}, "", url);
    this.changeRoute(newPath, this.state.location.query);
  }

  getTipColorAttribute(node, cScale) {
    if (cScale.colorBy.slice(0,3) === "gt-") {
        return getGenotype(cScale.genotype[0][0],
                                  cScale.genotype[0][1],
                                  node, this.props.sequences.sequences);
    } else {
      return node.attr[cScale.colorBy];
    };
  }

  updateColorScale(colorBy) {
    const cScale = getColorScale(colorBy, this.props.tree, this.props.sequences,
                                 this.props.metadata.metadata ? this.props.metadata.metadata.color_options : null);
    let gts = null;
    if (colorBy.slice(0,3) === "gt-" && this.props.sequences.geneLength) {
      gts = parseGenotype(colorBy, this.props.sequences.geneLength);
    }
    cScale.genotype = gts;
    return {
      colorScale: cScale,
    };
  }

  parseFilterQuery(query) {
    const tmp = query.split("-").map( (d) => d.split("."));
    return {"fields": tmp.map( (d) => d[0] ), "filters": tmp.map( (d) => d[d.length-1].split(',') )};
  }

  nodeColor(){
    const cScale = this.state.colorScale;
    if (this.props.tree.nodes && cScale && cScale.colorBy){
      const nodeColorAttr = this.props.tree.nodes.map((n) => this.getTipColorAttribute(n, cScale));
      return nodeColorAttr.map((n) => cScale.scale(n));
    }else{
      return null;
    }
  }

  tipVisibility(filters) {
    let upperLimit = this.props.dateMax;
    let lowerLimit = this.props.dateMin;

    if (this.props.tree.nodes){
      const filter_pairs = [];
      if (this.props.metadata && this.props.metadata.metadata) {
        for (const filter in this.props.metadata.metadata.controls) { // possible race condition with tree?
          const tmp = this.parseFilterQuery(this.state.location.query[filter] || "");
          for (let ii = 0; ii < tmp.filters.length; ii += 1) {
            if (tmp.filters[ii] && tmp.fields[ii]){
              filter_pairs.push([tmp.fields[ii], tmp.filters[ii]]);
            }
          }
        }
      }
      if (upperLimit && lowerLimit) {
        if (filter_pairs.length) {
          return this.props.tree.nodes.map((d) => (d.attr.date >= lowerLimit
            && d.attr.date < upperLimit
            && filter_pairs.every((x) => x[1].indexOf(d.attr[x[0]])>-1))
              ? "visible" : "hidden");
        } else {
          return this.props.tree.nodes.map((d) => (d.attr.date >= lowerLimit
            && d.attr.date < upperLimit)
              ? "visible" : "hidden");
        }
      }
    } else {
      return "visible";
    }
  }


  changeRoute(pathname, query) {
    pathname = pathname.replace("!/", ""); // needed to assist with S3 redirects
    const prefix = (pathname === "" || pathname[0] === "/") ? "" : "/";
    const suffix = (pathname.length && pathname[pathname.length - 1] !== "/") ? "/?" : "?";
    const url = prefix + pathname + suffix + queryString.stringify(query);
    window.history.pushState({}, "", url);

    let new_colorData = {};
    //only update colorScales and nodeColors when changed
    if (query.colorBy && (query.colorBy !== this.state.colorScale.colorBy)) {
      new_colorData = this.updateColorScale(query.colorBy);
    }
    this.setState(Object.assign({location:{query, pathname}}, new_colorData));
  }

  currentFrequencies() {
    let freq = "";
    if (this.state.location.query.colorBy && this.state.location.query.colorBy.slice(0,3) === "gt-") {
      const gt = this.state.location.query.colorBy.slice(3).split("_");
      freq = "global_" + gt[0] + ":" + gt[1];
    }
    return freq;
  }

  /******************************************
   * HOVER EVENTS
   *****************************************/
  determineLegendMatch(selectedLegendItem, node, legendBoundsMap) {
    let bool;
    const nodeAttr = this.getTipColorAttribute(node, this.state.colorScale);
    // equates a tip and a legend element
    // exact match is required for categorical qunantities such as genotypes, regions
    // continuous variables need to fall into the interal (lower_bound[leg], leg]
    if (legendBoundsMap) {
      bool = (nodeAttr <= legendBoundsMap.upper_bound[selectedLegendItem]) &&
             (nodeAttr > legendBoundsMap.lower_bound[selectedLegendItem]);
    } else {
      bool = nodeAttr === selectedLegendItem;
    }
    return bool;
  }

  tipRadii() {
    const selItem = this.props.selectedLegendItem;
    if (selItem && this.props.tree.nodes){
      const legendMap = this.state.colorScale.continuous
                        ? this.state.colorScale.legendBoundsMap : false;
      return this.props.tree.nodes.map((d) => this.determineLegendMatch(selItem, d, legendMap) ? 6 : 3);
    } else if (this.props.tree.nodes) {
      return this.props.tree.nodes.map((d) => 3);
    } else {
      return null;
    }
  }
  /******************************************
   * SIDEBAR
   *****************************************/

  onSetSidebarOpen(open) {
    this.setState({sidebarOpen: open});
  }

  mediaQueryChanged() {
    this.setState({sidebarDocked: this.state.mql.matches});
  }


  /******************************************
   * RENDER
   *****************************************/
  render() {
      return (
      <Sidebar
        sidebar={
          <Controls changeRoute={this.changeRoute.bind(this)}
            location={this.state.location}
            router={this.props.router}
            colorOptions={this.props.metadata.metadata ? (this.props.metadata.metadata.color_options || globals.colorOptions) : globals.colorOptions}
            colorScale={this.state.colorScale}
          />
        }
        open={this.state.sidebarOpen}
        docked={this.state.sidebarDocked}
        onSetOpen={this.onSetSidebarOpen}>
        <Background>
          <ToggleSidebarTab
            open={this.state.sidebarDocked}
            handler={() => {
              this.setState({sidebarDocked: !this.state.sidebarDocked})
            }}
          />
          <Header/>
            <TreeView nodes={this.props.tree.nodes}
              sidebar={this.state.sidebarOpen || this.state.sidebarDocked}
              colorScale={this.state.colorScale}
              nodeColor={this.nodeColor()}
              tipRadii={this.tipRadii()}
              tipVisibility={this.tipVisibility()}
              datasetGuid={this.props.tree.datasetGuid}
            />
            <Map
              sidebar={this.state.sidebarOpen || this.state.sidebarDocked}
              colorScale={this.state.colorScale.scale}
              nodes={this.props.tree.nodes}
              justGotNewDatasetRenderNewMap={false}
              />
            <Frequencies genotype={this.currentFrequencies()}/>
            <Entropy
              sidebar={this.state.sidebarOpen || this.state.sidebarDocked}
              changeRoute={this.changeRoute.bind(this)}
              location={this.state.location}
            />
        </Background>
      </Sidebar>
    );
  }
}


// <Footer/>


export default App;
